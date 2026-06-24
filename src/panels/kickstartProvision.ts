import { OutputChannel } from "vscode";
import { performance } from "perf_hooks";
import * as l10n from "@vscode/l10n";
import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { AzureAuthenticationSession, ReadyAzureSessionProvider } from "../auth/types";
import { getEnvironment } from "../auth/azureAuth";
import { getAksClient, getAuthorizationManagementClient, getResourceManagementClient } from "../commands/utils/arm";
import { getPortalResourceUrl, getPortalScopeAccessUrl } from "../commands/utils/env";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { getDeploymentErrorDetails, getDeploymentErrorMessage } from "../commands/utils/deploymentErrors";
import { createAcr, getAcrRegistry } from "../commands/utils/acrs";
import { DefinedManagedCluster, getManagedCluster } from "../commands/utils/clusters";
import {
    canCreateRoleAssignmentsAtResourceGroup,
    createRoleAssignment,
    findEligiblePimGrants,
    getPrincipalRoleAssignmentsForAcr,
    getScopeForAcr,
    getScopeForCluster,
} from "../commands/utils/roleAssignments";
import { acrPullRoleDefinitionName } from "../webview-contract/webviewDefinitions/attachAcrToCluster";
import { PresetType } from "../webview-contract/webviewDefinitions/createCluster";
import { ClusterSelections, ExistingClusterSelection } from "../webview-contract/webviewDefinitions/kickstartCluster";
import {
    ActivityStatus,
    PimEligibleGrant,
    ProvisioningAccessPrompt,
} from "../webview-contract/webviewDefinitions/kickstartShared";
import { ClusterDeploymentBuilder, ClusterSpec } from "./utilities/ClusterSpecCreationBuilder";
import {
    ActivityReporter,
    ActivitySink,
    CancellationToken,
    delay,
    formatElapsed,
    pollUntil,
    ProgressExtra,
    StageReporter,
} from "./kickstartActivity";
import {
    ACR_PULL_DATAACTION,
    checkDeploymentPermissions,
} from "../commands/aksCheckPermissions/checkDeploymentPermissions";

const DEPLOYMENT_API_VERSION = "2021-04-01";

const VERIFY_POLL_INTERVAL_MS = 3000;
// The AcrPull role assignment is created synchronously (an idempotent PUT), which is our authoritative
// "granted" signal. Observing it replicate through Azure AD is best-effort and non-fatal, so we only
// give it a short grace poll for live confirmation before downgrading to a soft "still propagating"
// warning rather than blocking provisioning. A brand-new kubelet identity can take several minutes to
// replicate, but the user doesn't need to wait that out — Design/Generate don't need pull access, and
// pulls only happen later at deploy time.
const PULL_PROPAGATION_GRACE_MS = 45000;
const CLUSTER_POLL_INTERVAL_MS = 15000;
const CLUSTER_POLL_TIMEOUT_MS = 1_800_000;
// Don't pre-assign AcrPull and hand back to chat the instant the kubelet identity appears — it can
// surface within the first ~30-90s, before we can be confident the create is genuinely underway.
// Fast-fail creates (quota, capacity, policy) usually surface in the first couple of minutes, so we
// require the cluster to have been actively "Creating" for at least this long first. That gives a high
// probability the create will actually finish before we detach the user into chat, at the cost of only
// ~2 of the ~15 provisioning minutes of phase overlap.
const MIN_CREATING_DWELL_MS = 120000;
// AKS Automatic clusters typically take ~15 minutes to provision. We have no server-provided
// percentage, so we drive a determinate progress bar from elapsed time against this estimate,
// capped below 100% until the real "Succeeded" state arrives.
const ESTIMATED_CLUSTER_CREATE_MS = 15 * 60 * 1000;

export type WaitForProvisioningAccess = (
    prompt: ProvisioningAccessPrompt,
    probe: () => Promise<boolean>,
) => Promise<boolean>;

interface DeploymentIdentity {
    username: string;
    servicePrincipalId: string;
}

interface ClusterDeploymentProgress {
    token: CancellationToken;
    reportProgress: (detail: string, extra?: ProgressExtra) => void;
    /**
     * Invoked (at most once) with the cluster's kubelet identity object ID as soon as it appears in
     * the cluster's `identityProfile` during provisioning, before the cluster reaches "Succeeded".
     * Lets the caller pre-assign AcrPull early so it propagates through Azure AD while the cluster
     * finishes creating.
     */
    onKubeletIdentity?: (kubeletObjectId: string) => void;
}

export interface ClusterProvisioningResult {
    succeeded: boolean;
    clusterName: string;
    clusterPortalUrl: string | null;
    acrName: string;
    acrLoginServer: string | null;
}

type StageOutcome = "continue" | "halt";

interface ProvisioningStage {
    id: string;
    title: string;
    execute: (stage: StageReporter, token: CancellationToken) => Promise<StageOutcome>;
    /**
     * When this stage is retried, restart from this earlier stage instead of itself, so the retry
     * reconciles the failure (e.g. `verify` re-runs the `attach` grant) rather than re-reading the
     * same failed state.
     */
    retryFromStageId?: string;
}

interface ProvisioningContext {
    clusterDeploymentName?: string;
}

export interface ProvisioningRun {
    runId: number;
    stageIds: string[];
    runFrom: (startStageId: string | undefined, token: CancellationToken) => Promise<ClusterProvisioningResult>;
}

async function runStages(
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    token: CancellationToken,
    stages: ProvisioningStage[],
    startStageId: string | undefined,
    result: ClusterProvisioningResult,
): Promise<ClusterProvisioningResult> {
    const reporter = new ActivityReporter("provision", runId, sink, channel, token);
    const requestedStage = startStageId === undefined ? undefined : stages.find((stage) => stage.id === startStageId);
    const effectiveStartStageId = requestedStage?.retryFromStageId ?? startStageId;
    const startIndex =
        effectiveStartStageId === undefined ? 0 : stages.findIndex((stage) => stage.id === effectiveStartStageId);
    if (startIndex < 0) {
        throw new Error(l10n.t("Unknown provisioning stage {0}.", effectiveStartStageId ?? ""));
    }

    result.succeeded = false;
    for (let i = startIndex; i < stages.length; i++) {
        const definition = stages[i];
        const stageReporter = reporter.stage(definition.id, definition.title);
        const outcome = await definition.execute(stageReporter, token);
        if (outcome === "halt") {
            return result;
        }
    }

    result.succeeded = true;
    return result;
}

function makeProvisioningRun(
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    stages: ProvisioningStage[],
    result: ClusterProvisioningResult,
): ProvisioningRun {
    return {
        runId,
        stageIds: stages.map((stage) => stage.id),
        runFrom: (startStageId, token) => runStages(runId, sink, channel, token, stages, startStageId, result),
    };
}

export function createClusterProvisioningRun(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    waitForAccess: WaitForProvisioningAccess,
    onChatReady?: (result: ClusterProvisioningResult) => void,
): ProvisioningRun {
    const result: ClusterProvisioningResult = {
        succeeded: false,
        clusterName: selections.clusterName,
        clusterPortalUrl: null,
        acrName: selections.acrName,
        acrLoginServer: null,
    };
    const context: ProvisioningContext = {};

    const stages: ProvisioningStage[] = [
        {
            id: "resourceGroup",
            title: l10n.t("Resource group"),
            execute: async (stage) => {
                try {
                    if (selections.isNewResourceGroup) {
                        await stage.run(l10n.t("Creating {0}", selections.resourceGroupName), () =>
                            createResourceGroup(sessionProvider, selections),
                        );
                        stage.succeed(l10n.t("Created resource group {0}.", selections.resourceGroupName));
                    } else {
                        stage.succeed(l10n.t("Using existing resource group {0}.", selections.resourceGroupName));
                    }
                    return "continue";
                } catch (e) {
                    stage.fail(getErrorMessage(e));
                    return "halt";
                }
            },
        },
        {
            id: "roleAccess",
            title: l10n.t("Role assignment access"),
            execute: async (stage) => {
                const authClient = getAuthorizationManagementClient(sessionProvider, selections.subscriptionId);
                const probeRoleAssignmentAccess = async (): Promise<boolean> => {
                    try {
                        const verdict = await canCreateRoleAssignmentsAtResourceGroup(
                            authClient,
                            selections.resourceGroupName,
                        );
                        return !failed(verdict) && verdict.result.canCreate;
                    } catch {
                        return false;
                    }
                };

                if (await probeRoleAssignmentAccess()) {
                    stage.succeed(l10n.t("You can assign roles in {0}.", selections.resourceGroupName));
                    return "continue";
                }

                const prompt = await buildProvisioningAccessPrompt(
                    authClient,
                    {
                        subscriptionId: selections.subscriptionId,
                        tenantId: selections.tenantId,
                        resourceGroupName: selections.resourceGroupName,
                    },
                    runId,
                    channel,
                );
                const granted = await stage.run(
                    l10n.t("Waiting for permission to assign roles in {0}", selections.resourceGroupName),
                    () => waitForAccess(prompt, probeRoleAssignmentAccess),
                );
                if (!granted) {
                    stage.fail(
                        l10n.t(
                            "Deployment stopped before creating the cluster because permission to assign roles in {0} wasn't granted.",
                            selections.resourceGroupName,
                        ),
                    );
                    return "halt";
                }
                stage.succeed(l10n.t("You can now assign roles in {0}.", selections.resourceGroupName));
                return "continue";
            },
        },
        {
            id: "acr",
            title: l10n.t("Azure Container Registry"),
            execute: async (stage) => {
                try {
                    const registry = await stage.run(
                        l10n.t("Creating registry {0}", selections.acrName),
                        async () => {
                            const created = await createAcr(
                                sessionProvider,
                                selections.subscriptionId,
                                selections.resourceGroupName,
                                selections.acrName,
                                selections.location,
                            );
                            if (failed(created)) {
                                throw new Error(created.error);
                            }
                            return created.result;
                        },
                        (registry) => registry.loginServer,
                    );
                    result.acrLoginServer = registry.loginServer;
                    stage.succeed(l10n.t("Registry {0} is ready.", registry.loginServer));
                    return "continue";
                } catch (e) {
                    stage.fail(getErrorMessage(e));
                    return "halt";
                }
            },
        },
        {
            id: "cluster",
            title: l10n.t("AKS Automatic cluster"),
            execute: async (stage, token) => {
                try {
                    const kubernetesVersion = await stage.run(
                        l10n.t("Selecting Kubernetes version"),
                        () =>
                            resolveDefaultKubernetesVersion(
                                sessionProvider,
                                selections.subscriptionId,
                                selections.location,
                            ),
                        (version) => version,
                    );
                    const identity = await stage.run(l10n.t("Resolving your account identity"), () =>
                        resolveDeploymentIdentity(sessionProvider),
                    );
                    // Reuse the same deployment name across retries so a re-run reconciles the existing
                    // deployment instead of starting a competing one.
                    context.clusterDeploymentName ??= `${selections.clusterName}-${Math.random().toString(36).substring(5)}`;
                    const deploymentName = context.clusterDeploymentName;

                    // Pre-authorize image pulls as early as possible. The kubelet identity appears in the
                    // cluster's identityProfile minutes before provisioning completes, and the ACR already
                    // exists (created in the previous stage). Assigning AcrPull now lets the role assignment
                    // propagate through Azure AD while the cluster finishes, so the later verify step
                    // usually passes immediately instead of waiting on brand-new-identity replication lag.
                    const preauthAction = l10n.t("Pre-authorize image pulls");
                    let earlyGrant: Promise<void> | undefined;
                    const grantAcrPullEarly = (kubeletObjectId: string): void => {
                        if (earlyGrant) {
                            return; // one-shot
                        }
                        // The kubelet identity surfaced — flip the pending row to "assigning" and stamp
                        // startedAt now so the row records when the pre-authorization actually ran.
                        stage.upsertEntry({
                            action: preauthAction,
                            status: "running",
                            detail: l10n.t("Found the kubelet identity — assigning AcrPull…"),
                            code: kubeletObjectId,
                            startedAt: Date.now(),
                        });
                        earlyGrant = (async () => {
                            try {
                                const authClient = getAuthorizationManagementClient(
                                    sessionProvider,
                                    selections.subscriptionId,
                                );
                                await grantAcrPull(
                                    authClient,
                                    selections.subscriptionId,
                                    kubeletObjectId,
                                    selections.resourceGroupName,
                                    selections.acrName,
                                );
                                stage.upsertEntry({
                                    action: preauthAction,
                                    status: "succeeded",
                                    detail: l10n.t(
                                        "Assigned AcrPull to the kubelet identity while the cluster finished provisioning, giving Azure AD time to propagate it.",
                                    ),
                                    code: kubeletObjectId,
                                });
                                // The kubelet identity now holds AcrPull and the cluster create is well
                                // underway, so hand back to chat early. The portal URL is deterministic
                                // from the cluster's ARM id (the create returns the same value later), and
                                // Phases 3–4 (Design/Generate) don't need the cluster to be ready — letting
                                // the user resume in chat while the create + RBAC propagation finish in the
                                // background.
                                result.clusterPortalUrl ??= getPortalResourceUrl(
                                    getEnvironment(),
                                    getScopeForCluster(
                                        selections.subscriptionId,
                                        selections.resourceGroupName,
                                        selections.clusterName,
                                    ),
                                );
                                onChatReady?.(result);
                                // Confirm the brand-new assignment is actually observable while the cluster
                                // is still provisioning, so the user sees pull access go live rather than
                                // just "assigned". Non-fatal: the dedicated verify stage re-checks afterwards.
                                await confirmEarlyPullAccess(
                                    stage,
                                    token,
                                    {
                                        subscriptionId: selections.subscriptionId,
                                        resourceGroup: selections.resourceGroupName,
                                        clusterName: selections.clusterName,
                                        acrName: selections.acrName,
                                    },
                                    kubeletObjectId,
                                );
                            } catch (e) {
                                // Non-fatal: the dedicated attach/verify stages reconcile this grant afterwards.
                                stage.upsertEntry({
                                    action: preauthAction,
                                    status: "warning",
                                    detail: l10n.t(
                                        "Couldn't pre-assign AcrPull yet ({0}); the connect step will assign it once the cluster is ready.",
                                        getErrorMessage(e),
                                    ),
                                    code: kubeletObjectId,
                                });
                            }
                        })();
                    };

                    result.clusterPortalUrl = await stage.run(
                        l10n.t("Deploying cluster — this can take several minutes"),
                        (reportProgress) => {
                            // Surface the pre-authorization as pending the moment cluster create starts, so
                            // the user can see we're polling for the kubelet identity to pre-grant pulls.
                            stage.upsertEntry({
                                action: preauthAction,
                                status: "running",
                                detail: l10n.t(
                                    "Polling for the cluster's kubelet identity to pre-authorize image pulls…",
                                ),
                            });
                            return deployAutomaticCluster(
                                sessionProvider,
                                selections,
                                kubernetesVersion,
                                identity,
                                true,
                                deploymentName,
                                { token, reportProgress, onKubeletIdentity: grantAcrPullEarly },
                            );
                        },
                    );
                    // Let any in-flight early grant + propagation check finish reporting before the stage closes.
                    await earlyGrant;
                    if (!earlyGrant) {
                        // The kubelet identity never surfaced during provisioning (rare); the attach/verify
                        // stages will assign and confirm pull access once the cluster is ready.
                        stage.upsertEntry({
                            action: preauthAction,
                            status: "warning",
                            detail: l10n.t(
                                "The kubelet identity didn't appear before the cluster finished; the connect step will assign pull access.",
                            ),
                        });
                    }
                    stage.succeed(l10n.t("Cluster {0} is ready.", selections.clusterName));
                    return "continue";
                } catch (e) {
                    stage.fail(getDeploymentErrorMessage(e), getDeploymentErrorDetails(e));
                    return "halt";
                }
            },
        },
        {
            id: "attach",
            title: l10n.t("Connect registry to cluster"),
            execute: async (stage) => {
                try {
                    const principalId = await stage.run(l10n.t("Granting the cluster permission to pull images"), () =>
                        attachAcrToCluster(sessionProvider, selections),
                    );
                    stage.addEntry({
                        action: l10n.t("Cluster kubelet identity"),
                        status: "succeeded",
                        detail: l10n.t("Assigned the AcrPull role to the cluster's kubelet identity."),
                        code: principalId,
                    });
                    stage.addEntry({
                        action: l10n.t("AcrPull role definition"),
                        status: "succeeded",
                        detail: l10n.t("Built-in role granting `{0}`.", ACR_PULL_DATAACTION),
                        code: acrPullRoleDefinitionName,
                    });
                    stage.succeed(
                        l10n.t(
                            "Assigned AcrPull on {1} to {0}. A brand-new cluster identity can take a few minutes to propagate through Azure AD before pulls succeed.",
                            selections.clusterName,
                            selections.acrName,
                        ),
                    );
                } catch (e) {
                    stage.fail(getErrorMessage(e));
                }
                // Continue even when the grant fails: the verify stage polls for pull access and reports
                // the authoritative result once RBAC propagation settles.
                return "continue";
            },
        },
        {
            id: "verify",
            retryFromStageId: "attach",
            title: l10n.t("Verify registry pull access"),
            execute: async (stage, token) => {
                await runDeploymentVerificationStage(stage, token, {
                    subscriptionId: selections.subscriptionId,
                    resourceGroup: selections.resourceGroupName,
                    clusterName: selections.clusterName,
                    acrName: selections.acrName,
                });
                return "continue";
            },
        },
    ];

    return makeProvisioningRun(runId, sink, channel, stages, result);
}

async function buildProvisioningAccessPrompt(
    client: AuthorizationManagementClient,
    args: { subscriptionId: string; tenantId: string; resourceGroupName: string },
    runId: number,
    channel: OutputChannel,
): Promise<ProvisioningAccessPrompt> {
    const resourceGroupScope = `/subscriptions/${args.subscriptionId}/resourceGroups/${args.resourceGroupName}`;
    const eligible = await findEligiblePimGrants(client, resourceGroupScope, (msg) => channel.appendLine(msg));
    const eligiblePimGrants: PimEligibleGrant[] =
        !failed(eligible) && eligible.result.length > 0
            ? eligible.result.map((grant) => ({
                  roleName: grant.roleName,
                  scopeId: grant.scopeId,
                  scopeDisplayName: grant.scopeDisplayName ?? grant.scopeId,
              }))
            : [];
    const permissionActionUrl = getPortalScopeAccessUrl(getEnvironment(), args.tenantId, resourceGroupScope);
    const detail =
        eligiblePimGrants.length > 0
            ? l10n.t("Activate an eligible role in Privileged Identity Management, then select Re-check to continue.")
            : l10n.t(
                  "You don't have an eligible role that can assign roles in {0}. Ask an administrator for access, then select Re-check.",
                  args.resourceGroupName,
              );
    return {
        runId,
        resourceGroupName: args.resourceGroupName,
        eligiblePimGrants,
        permissionActionUrl,
        detail,
    };
}

export function createExistingClusterAttachRun(
    sessionProvider: ReadyAzureSessionProvider,
    selection: ExistingClusterSelection,
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    waitForAccess: WaitForProvisioningAccess,
): ProvisioningRun {
    const result: ClusterProvisioningResult = {
        succeeded: false,
        clusterName: selection.clusterName,
        clusterPortalUrl: null,
        acrName: selection.acrName,
        acrLoginServer: null,
    };

    const stages: ProvisioningStage[] = [
        {
            id: "cluster",
            title: l10n.t("AKS cluster"),
            execute: async (stage) => {
                try {
                    await stage.run(l10n.t("Resolving cluster {0}", selection.clusterName), async () => {
                        const found = await getManagedCluster(
                            sessionProvider,
                            selection.subscriptionId,
                            selection.clusterResourceGroup,
                            selection.clusterName,
                        );
                        if (failed(found)) {
                            throw new Error(found.error);
                        }
                        return found.result;
                    });
                    const clusterArmId = getScopeForCluster(
                        selection.subscriptionId,
                        selection.clusterResourceGroup,
                        selection.clusterName,
                    );
                    result.clusterPortalUrl = getPortalResourceUrl(getEnvironment(), clusterArmId);
                    stage.succeed(l10n.t("Using cluster {0}.", selection.clusterName));
                    return "continue";
                } catch (e) {
                    stage.fail(getDeploymentErrorMessage(e), getDeploymentErrorDetails(e));
                    return "halt";
                }
            },
        },
        {
            id: "acr",
            title: l10n.t("Azure Container Registry"),
            execute: async (stage) => {
                try {
                    const registry = await stage.run(
                        selection.createNewAcr
                            ? l10n.t("Creating registry {0}", selection.acrName)
                            : l10n.t("Confirming registry {0}", selection.acrName),
                        async () => {
                            const registryResult = selection.createNewAcr
                                ? await createAcr(
                                      sessionProvider,
                                      selection.subscriptionId,
                                      selection.acrResourceGroup,
                                      selection.acrName,
                                      await resolveClusterLocation(sessionProvider, selection),
                                  )
                                : await getAcrRegistry(
                                      sessionProvider,
                                      selection.subscriptionId,
                                      selection.acrResourceGroup,
                                      selection.acrName,
                                  );
                            if (failed(registryResult)) {
                                throw new Error(registryResult.error);
                            }
                            return registryResult.result;
                        },
                        (registry) => registry.loginServer,
                    );
                    result.acrLoginServer = registry.loginServer;
                    stage.succeed(l10n.t("Registry {0} is ready.", registry.loginServer));
                    return "continue";
                } catch (e) {
                    stage.fail(getErrorMessage(e));
                    return "halt";
                }
            },
        },
        {
            id: "roleAccess",
            title: l10n.t("Role assignment access"),
            execute: async (stage) => {
                const authClient = getAuthorizationManagementClient(sessionProvider, selection.subscriptionId);

                // Decide whether this run will need to assign AcrPull. A brand-new ACR always does. For an
                // existing ACR we re-check the kubelet's live assignments rather than trusting the
                // point-in-time "connected" snapshot from cluster selection — if it already holds AcrPull
                // no role assignment is needed and we can skip the permission gate entirely.
                let needsGrant = selection.createNewAcr;
                if (!needsGrant) {
                    try {
                        const kubeletPrincipalId = await resolveClusterKubeletPrincipalId(
                            sessionProvider,
                            selection.subscriptionId,
                            selection.clusterResourceGroup,
                            selection.clusterName,
                        );
                        needsGrant = !(await kubeletHasAcrPull(
                            authClient,
                            kubeletPrincipalId,
                            selection.acrResourceGroup,
                            selection.acrName,
                        ));
                    } catch {
                        // Couldn't confirm the current assignment — gate defensively so that a grant we
                        // end up needing in the attach stage doesn't hard-fail on missing permission.
                        needsGrant = true;
                    }
                }

                if (!needsGrant) {
                    stage.succeed(
                        l10n.t(
                            "{0} already holds AcrPull on {1}; no role assignment is needed.",
                            selection.clusterName,
                            selection.acrName,
                        ),
                    );
                    return "continue";
                }

                // AcrPull is assigned at the registry's resource group, so that's where we need
                // Microsoft.Authorization/roleAssignments/write.
                const probeRoleAssignmentAccess = async (): Promise<boolean> => {
                    try {
                        const verdict = await canCreateRoleAssignmentsAtResourceGroup(
                            authClient,
                            selection.acrResourceGroup,
                        );
                        return !failed(verdict) && verdict.result.canCreate;
                    } catch {
                        return false;
                    }
                };

                if (await probeRoleAssignmentAccess()) {
                    stage.succeed(l10n.t("You can assign roles in {0}.", selection.acrResourceGroup));
                    return "continue";
                }

                const prompt = await buildProvisioningAccessPrompt(
                    authClient,
                    {
                        subscriptionId: selection.subscriptionId,
                        tenantId: selection.tenantId,
                        resourceGroupName: selection.acrResourceGroup,
                    },
                    runId,
                    channel,
                );
                const granted = await stage.run(
                    l10n.t("Waiting for permission to assign roles in {0}", selection.acrResourceGroup),
                    () => waitForAccess(prompt, probeRoleAssignmentAccess),
                );
                if (!granted) {
                    stage.fail(
                        l10n.t(
                            "Couldn't connect {0} to {1} because permission to assign roles in {2} wasn't granted.",
                            selection.clusterName,
                            selection.acrName,
                            selection.acrResourceGroup,
                        ),
                    );
                    return "halt";
                }
                stage.succeed(l10n.t("You can now assign roles in {0}.", selection.acrResourceGroup));
                return "continue";
            },
        },
        {
            id: "attach",
            title: l10n.t("Connect registry to cluster"),
            execute: async (stage) => {
                try {
                    const client = getAuthorizationManagementClient(sessionProvider, selection.subscriptionId);
                    const kubeletPrincipalId = await resolveClusterKubeletPrincipalId(
                        sessionProvider,
                        selection.subscriptionId,
                        selection.clusterResourceGroup,
                        selection.clusterName,
                    );
                    // Re-check the live assignment on every run (including retries) so a failed verify can
                    // self-heal: if AcrPull is missing we (idempotently) (re)grant it instead of assuming
                    // the cluster is already connected.
                    const alreadyConnected =
                        !selection.createNewAcr &&
                        (await kubeletHasAcrPull(
                            client,
                            kubeletPrincipalId,
                            selection.acrResourceGroup,
                            selection.acrName,
                        ));
                    if (alreadyConnected) {
                        stage.succeed(
                            l10n.t(
                                "{0} is already connected to {1}, so no permission changes are needed.",
                                selection.clusterName,
                                selection.acrName,
                            ),
                        );
                        return "continue";
                    }
                    await stage.run(l10n.t("Granting the cluster permission to pull images"), () =>
                        grantAcrPull(
                            client,
                            selection.subscriptionId,
                            kubeletPrincipalId,
                            selection.acrResourceGroup,
                            selection.acrName,
                        ),
                    );
                    stage.succeed(
                        l10n.t("{0} can now pull images from {1}.", selection.clusterName, selection.acrName),
                    );
                    return "continue";
                } catch (e) {
                    stage.fail(getErrorMessage(e));
                    return "halt";
                }
            },
        },
        {
            id: "verify",
            retryFromStageId: "attach",
            title: l10n.t("Verify registry pull access"),
            execute: async (stage, token) => {
                await runDeploymentVerificationStage(stage, token, {
                    subscriptionId: selection.subscriptionId,
                    resourceGroup: selection.clusterResourceGroup,
                    clusterName: selection.clusterName,
                    acrName: selection.acrName,
                    acrResourceGroup: selection.acrResourceGroup,
                });
                return "continue";
            },
        },
    ];

    return makeProvisioningRun(runId, sink, channel, stages, result);
}

async function resolveClusterLocation(
    sessionProvider: ReadyAzureSessionProvider,
    selection: ExistingClusterSelection,
): Promise<string> {
    const cluster = await getManagedCluster(
        sessionProvider,
        selection.subscriptionId,
        selection.clusterResourceGroup,
        selection.clusterName,
    );
    if (failed(cluster)) {
        throw new Error(cluster.error);
    }
    return cluster.result.location;
}

async function runDeploymentVerificationStage(
    stage: StageReporter,
    token: CancellationToken,
    args: {
        subscriptionId: string;
        resourceGroup: string;
        clusterName: string;
        acrName?: string;
        acrResourceGroup?: string;
    },
): Promise<void> {
    const probeResult = await stage.run(
        l10n.t("Checking the cluster can pull from the registry"),
        async (reportProgress) => {
            const { result } = await pollUntil(
                () => checkDeploymentPermissions(undefined, { ...args, probeScope: "kubelet-pull", silent: true }),
                (r) => Boolean(r.error) || r.allPassed === true,
                {
                    intervalMs: VERIFY_POLL_INTERVAL_MS,
                    timeoutMs: PULL_PROPAGATION_GRACE_MS,
                    token,
                    onWait: (elapsedMs) =>
                        reportProgress(
                            l10n.t(
                                "Waiting for the new role assignment to propagate through Azure AD… ({0})",
                                formatElapsed(elapsedMs),
                            ),
                        ),
                },
            );
            return result;
        },
    );

    if (probeResult.error) {
        stage.warn(probeResult.error);
        return;
    }

    const probes = probeResult.probes ?? [];
    for (const probe of probes) {
        stage.addEntry({
            action: probe.label,
            status: probeStatusToActivityStatus(probe.status),
            detail: probe.reason,
            code: probe.principalId,
        });
    }

    if (probeResult.allPassed) {
        stage.succeed(l10n.t("The cluster can pull images from the registry."));
    } else {
        const remediation = probes.find((p) => p.remediation)?.remediation;
        stage.warn(
            l10n.t(
                "The AcrPull role is assigned, but the cluster can't pull from the registry yet — a brand-new kubelet identity can take several minutes to propagate through Azure AD. This usually clears on its own; retry to check again.",
            ),
            remediation
                ? l10n.t("If pulls keep failing, you can re-assign the role manually:\n\n{0}", remediation)
                : undefined,
        );
    }
}

/**
 * Polls the kubelet ACR-pull permission right after the early pre-authorization grant, while the
 * cluster is still provisioning, and updates a single activity row from "checking" → "live" (or a
 * soft "still propagating" warning). Lets the user watch the brand-new role assignment become
 * effective instead of waiting until the post-create verify stage. Non-fatal by design.
 */
async function confirmEarlyPullAccess(
    stage: StageReporter,
    token: CancellationToken,
    args: {
        subscriptionId: string;
        resourceGroup: string;
        clusterName: string;
        acrName?: string;
        acrResourceGroup?: string;
    },
    kubeletObjectId: string,
): Promise<void> {
    const action = l10n.t("Confirm image pull access");
    stage.upsertEntry({
        action,
        status: "running",
        detail: l10n.t("Checking the AcrPull assignment has propagated through Azure AD…"),
        code: kubeletObjectId,
        startedAt: Date.now(),
    });

    const { result, timedOut } = await pollUntil(
        () => checkDeploymentPermissions(undefined, { ...args, probeScope: "kubelet-pull", silent: true }),
        (r) => Boolean(r.error) || r.allPassed === true,
        {
            intervalMs: VERIFY_POLL_INTERVAL_MS,
            timeoutMs: PULL_PROPAGATION_GRACE_MS,
            token,
            onWait: (elapsedMs) =>
                stage.upsertEntry({
                    action,
                    status: "running",
                    detail: l10n.t(
                        "Waiting for the AcrPull assignment to propagate through Azure AD… ({0})",
                        formatElapsed(elapsedMs),
                    ),
                    code: kubeletObjectId,
                }),
        },
    );

    if (result.error) {
        stage.upsertEntry({ action, status: "warning", detail: result.error, code: kubeletObjectId });
        return;
    }
    if (result.allPassed) {
        stage.upsertEntry({
            action,
            status: "succeeded",
            detail: args.acrName
                ? l10n.t("Image pull access is live — the cluster can pull from {0}.", args.acrName)
                : l10n.t("Image pull access is live."),
            code: kubeletObjectId,
        });
        return;
    }
    stage.upsertEntry({
        action,
        status: "warning",
        detail: timedOut
            ? l10n.t("Still propagating; the verify step will confirm once it settles.")
            : l10n.t("Not effective yet; the verify step will confirm once it settles."),
        code: kubeletObjectId,
    });
}

function probeStatusToActivityStatus(status: "pass" | "fail" | "unknown"): ActivityStatus {
    switch (status) {
        case "pass":
            return "succeeded";
        case "fail":
            return "failed";
        case "unknown":
            return "warning";
    }
}

async function createResourceGroup(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
): Promise<void> {
    const client = getResourceManagementClient(sessionProvider, selections.subscriptionId);
    await client.resourceGroups.createOrUpdate(selections.resourceGroupName, { location: selections.location });
}

async function resolveDefaultKubernetesVersion(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    location: string,
): Promise<string> {
    const client = getAksClient(sessionProvider, subscriptionId);
    const versionsResult = await client.managedClusters.listKubernetesVersions(location);
    const versions = versionsResult.values || [];
    const preferred = versions.find((v) => "isDefault" in v && v.isDefault === true) ?? versions[0];
    if (!preferred?.version) {
        throw new Error(l10n.t("No Kubernetes versions are available in {0}.", location));
    }
    return preferred.version;
}

async function resolveDeploymentIdentity(sessionProvider: ReadyAzureSessionProvider): Promise<DeploymentIdentity> {
    const session = await sessionProvider.getAuthSession();
    if (failed(session)) {
        throw new Error(session.error);
    }
    const servicePrincipalId = getServicePrincipalId(session.result);
    if (!servicePrincipalId) {
        throw new Error(l10n.t("Couldn't determine the signed-in user's identity for cluster RBAC."));
    }
    return { username: session.result.account.label, servicePrincipalId };
}

async function deployAutomaticCluster(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
    kubernetesVersion: string,
    identity: DeploymentIdentity,
    assignClusterAdminRole: boolean,
    deploymentName: string,
    progress?: ClusterDeploymentProgress,
): Promise<string> {
    const clusterArmId = `/subscriptions/${selections.subscriptionId}/resourceGroups/${selections.resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${selections.clusterName}`;
    const aksClient = getAksClient(sessionProvider, selections.subscriptionId);

    // Reconcile before (re)deploying so a retry doesn't issue a second create over a cluster that
    // already exists or is still provisioning. A first run finds no cluster (404) and falls through.
    const existingState = await tryGetClusterProvisioningState(
        aksClient,
        selections.resourceGroupName,
        selections.clusterName,
    );
    if (existingState === "Succeeded") {
        return getPortalResourceUrl(getEnvironment(), clusterArmId);
    }
    if (existingState !== undefined && !isTerminalProvisioningState(existingState)) {
        await pollClusterUntilTerminal(aksClient, selections, progress);
        return getPortalResourceUrl(getEnvironment(), clusterArmId);
    }

    const clusterSpec: ClusterSpec = {
        location: selections.location,
        name: selections.clusterName,
        resourceGroupName: selections.resourceGroupName,
        subscriptionId: selections.subscriptionId,
        kubernetesVersion,
        username: identity.username,
        servicePrincipalId: identity.servicePrincipalId,
        assignClusterAdminRole,
    };

    const deployment = new ClusterDeploymentBuilder()
        .buildCommonParameters(clusterSpec, PresetType.Automatic)
        .buildTemplate(PresetType.Automatic)
        .getDeployment();

    const deploymentResourceId = `/subscriptions/${selections.subscriptionId}/resourceGroups/${selections.resourceGroupName}/providers/Microsoft.Resources/deployments/${deploymentName}`;

    const client = getResourceManagementClient(sessionProvider, selections.subscriptionId);
    const poller = await client.resources.beginCreateOrUpdateById(deploymentResourceId, DEPLOYMENT_API_VERSION, {
        properties: deployment.properties,
    });

    if (progress) {
        let settled = false;
        const done = poller.pollUntilDone().finally(() => {
            settled = true;
        });
        await Promise.all([done, tickClusterStatus(sessionProvider, selections, () => settled, progress)]);
    } else {
        await poller.pollUntilDone();
    }

    return getPortalResourceUrl(getEnvironment(), clusterArmId);
}

async function tickClusterStatus(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
    isSettled: () => boolean,
    progress: ClusterDeploymentProgress,
): Promise<void> {
    const aksClient = getAksClient(sessionProvider, selections.subscriptionId);
    const start = performance.now();
    while (!isSettled()) {
        await delay(CLUSTER_POLL_INTERVAL_MS);
        if (isSettled() || progress.token.isCancelled) {
            return;
        }
        const elapsedMs = performance.now() - start;
        const elapsed = formatElapsed(elapsedMs);
        // ARM exposes no completion percentage for a cluster create, so estimate against a typical
        // ~15-minute provisioning time. Cap below 100% so the bar never claims completion before the
        // real "Succeeded" state arrives.
        const pct = Math.min(95, Math.round((elapsedMs / ESTIMATED_CLUSTER_CREATE_MS) * 100));
        try {
            const cluster = await aksClient.managedClusters.get(selections.resourceGroupName, selections.clusterName);
            // The kubelet identity is populated partway through provisioning. Surface it to pre-assign
            // AcrPull and hand back to chat, but only once the cluster has been actively "Creating" for
            // MIN_CREATING_DWELL_MS — so we detach with high confidence the create is genuinely underway
            // rather than the instant the identity appears (when a fast-fail create could still be looming).
            const identityProfile = cluster.identityProfile;
            const kubeletObjectId =
                identityProfile && "kubeletidentity" in identityProfile
                    ? identityProfile.kubeletidentity?.objectId
                    : undefined;
            if (kubeletObjectId && elapsedMs >= MIN_CREATING_DWELL_MS && cluster.provisioningState === "Creating") {
                progress.onKubeletIdentity?.(kubeletObjectId);
            }
            progress.reportProgress(
                l10n.t("Cluster status: {0} ({1})", cluster.provisioningState ?? "Creating", elapsed),
                { progress: pct },
            );
        } catch {
            progress.reportProgress(l10n.t("Waiting for the cluster to appear… ({0})", elapsed), {
                progress: pct,
            });
        }
    }
}

function isTerminalProvisioningState(state: string): boolean {
    return state === "Succeeded" || state === "Failed" || state === "Canceled";
}

function isNotFoundError(e: unknown): boolean {
    if (typeof e !== "object" || e === null) {
        return false;
    }
    const error = e as { statusCode?: number; code?: string };
    return error.statusCode === 404 || error.code === "ResourceNotFound";
}

async function tryGetClusterProvisioningState(
    aksClient: ReturnType<typeof getAksClient>,
    resourceGroup: string,
    clusterName: string,
): Promise<string | undefined> {
    try {
        const cluster = await aksClient.managedClusters.get(resourceGroup, clusterName);
        return cluster.provisioningState ?? undefined;
    } catch (e) {
        if (isNotFoundError(e)) {
            return undefined;
        }
        throw e;
    }
}

async function pollClusterUntilTerminal(
    aksClient: ReturnType<typeof getAksClient>,
    selections: ClusterSelections,
    progress?: ClusterDeploymentProgress,
): Promise<void> {
    const { result, timedOut } = await pollUntil(
        () => tryGetClusterProvisioningState(aksClient, selections.resourceGroupName, selections.clusterName),
        (state) => state === undefined || isTerminalProvisioningState(state),
        {
            intervalMs: CLUSTER_POLL_INTERVAL_MS,
            timeoutMs: CLUSTER_POLL_TIMEOUT_MS,
            token: progress?.token ?? new CancellationToken(),
            onWait: (elapsedMs, state) => {
                const pct = Math.min(95, Math.round((elapsedMs / ESTIMATED_CLUSTER_CREATE_MS) * 100));
                progress?.reportProgress(
                    l10n.t("Cluster status: {0} ({1})", state ?? "Creating", formatElapsed(elapsedMs)),
                    { progress: pct },
                );
            },
        },
    );
    if (timedOut) {
        throw new Error(l10n.t("Timed out waiting for cluster {0} to finish provisioning.", selections.clusterName));
    }
    if (result === "Failed" || result === "Canceled") {
        throw new Error(l10n.t("Cluster {0} provisioning {1}.", selections.clusterName, result.toLowerCase()));
    }
    if (result === undefined) {
        throw new Error(l10n.t("Cluster {0} could not be found after provisioning.", selections.clusterName));
    }
}

async function attachAcrToCluster(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
): Promise<string> {
    const principalId = await resolveClusterKubeletPrincipalId(
        sessionProvider,
        selections.subscriptionId,
        selections.resourceGroupName,
        selections.clusterName,
    );
    const client = getAuthorizationManagementClient(sessionProvider, selections.subscriptionId);
    await grantAcrPull(
        client,
        selections.subscriptionId,
        principalId,
        selections.resourceGroupName,
        selections.acrName,
    );
    return principalId;
}

async function grantAcrPull(
    client: AuthorizationManagementClient,
    subscriptionId: string,
    principalId: string,
    acrResourceGroup: string,
    acrName: string,
): Promise<void> {
    const scope = getScopeForAcr(subscriptionId, acrResourceGroup, acrName);
    const assignment = await createRoleAssignment(
        client,
        subscriptionId,
        principalId,
        acrPullRoleDefinitionName,
        scope,
        "ServicePrincipal",
    );
    if (failed(assignment)) {
        throw new Error(assignment.error);
    }
}

/**
 * Returns true iff the given principal already holds the AcrPull role assignment on the registry.
 * Used to defensively re-check the point-in-time "connected ACR" snapshot before deciding whether a
 * (re)grant — and the role-assignment-write permission it requires — is actually needed. A failed
 * lookup returns false so callers gate/grant defensively rather than assuming access exists.
 */
async function kubeletHasAcrPull(
    client: AuthorizationManagementClient,
    principalId: string,
    acrResourceGroup: string,
    acrName: string,
): Promise<boolean> {
    const assignments = await getPrincipalRoleAssignmentsForAcr(client, principalId, acrResourceGroup, acrName);
    if (failed(assignments)) {
        return false;
    }
    return assignments.result.some(
        (ra) => (ra.roleDefinitionId?.split("/").pop() ?? "").toLowerCase() === acrPullRoleDefinitionName.toLowerCase(),
    );
}

export async function resolveClusterKubeletPrincipalId(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): Promise<string> {
    const cluster = await getManagedCluster(sessionProvider, subscriptionId, resourceGroup, clusterName);
    if (failed(cluster)) {
        throw new Error(cluster.error);
    }

    const principalId = getKubeletPrincipalId(cluster.result);
    if (!principalId) {
        throw new Error(l10n.t("Couldn't find the cluster identity needed to grant registry access."));
    }
    return principalId;
}

function getKubeletPrincipalId(cluster: DefinedManagedCluster): string | null {
    const kubeletIdentity =
        cluster.identityProfile && "kubeletidentity" in cluster.identityProfile
            ? cluster.identityProfile.kubeletidentity
            : undefined;
    return kubeletIdentity?.objectId ?? null;
}

function getServicePrincipalId(session: AzureAuthenticationSession): string {
    if (!session?.account?.id) {
        return "";
    }
    const accountId = session.account.id;
    if (accountId.includes("/")) {
        return accountId.split("/")[1];
    }
    if (accountId.includes(".")) {
        return accountId.split(".")[0];
    }
    return "";
}
