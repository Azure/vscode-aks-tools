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
    StageReporter,
} from "./kickstartActivity";
import { checkDeploymentPermissions } from "../commands/aksCheckPermissions/checkDeploymentPermissions";

const DEPLOYMENT_API_VERSION = "2021-04-01";

const VERIFY_POLL_INTERVAL_MS = 3000;
const VERIFY_POLL_TIMEOUT_MS = 90000;
const CLUSTER_POLL_INTERVAL_MS = 15000;
const CLUSTER_POLL_TIMEOUT_MS = 1_800_000;

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
    reportProgress: (detail: string) => void;
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
    const startIndex = startStageId === undefined ? 0 : stages.findIndex((stage) => stage.id === startStageId);
    if (startIndex < 0) {
        throw new Error(l10n.t("Unknown provisioning stage {0}.", startStageId ?? ""));
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

                const prompt = await buildProvisioningAccessPrompt(authClient, selections, runId, channel);
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
                    result.clusterPortalUrl = await stage.run(
                        l10n.t("Deploying cluster — this can take several minutes"),
                        (reportProgress) =>
                            deployAutomaticCluster(
                                sessionProvider,
                                selections,
                                kubernetesVersion,
                                identity,
                                true,
                                deploymentName,
                                { token, reportProgress },
                            ),
                    );
                    stage.succeed(l10n.t("Cluster {0} is ready.", selections.clusterName));
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
            id: "attach",
            title: l10n.t("Connect registry to cluster"),
            execute: async (stage) => {
                try {
                    await stage.run(l10n.t("Granting the cluster permission to pull images"), () =>
                        attachAcrToCluster(sessionProvider, selections),
                    );
                    stage.succeed(
                        l10n.t("{0} can now pull images from {1}.", selections.clusterName, selections.acrName),
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
    selections: ClusterSelections,
    runId: number,
    channel: OutputChannel,
): Promise<ProvisioningAccessPrompt> {
    const resourceGroupScope = `/subscriptions/${selections.subscriptionId}/resourceGroups/${selections.resourceGroupName}`;
    const eligible = await findEligiblePimGrants(client, resourceGroupScope, (msg) => channel.appendLine(msg));
    const eligiblePimGrants: PimEligibleGrant[] =
        !failed(eligible) && eligible.result.length > 0
            ? eligible.result.map((grant) => ({
                  roleName: grant.roleName,
                  scopeId: grant.scopeId,
                  scopeDisplayName: grant.scopeDisplayName ?? grant.scopeId,
              }))
            : [];
    const permissionActionUrl = getPortalScopeAccessUrl(getEnvironment(), selections.tenantId, resourceGroupScope);
    const detail =
        eligiblePimGrants.length > 0
            ? l10n.t("Activate an eligible role in Privileged Identity Management, then select Re-check to continue.")
            : l10n.t(
                  "You don't have an eligible role that can assign roles in {0}. Ask an administrator for access, then select Re-check.",
                  selections.resourceGroupName,
              );
    return {
        runId,
        resourceGroupName: selections.resourceGroupName,
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
            id: "attach",
            title: l10n.t("Connect registry to cluster"),
            execute: async (stage) => {
                try {
                    if (selection.createNewAcr) {
                        await stage.run(l10n.t("Granting the cluster permission to pull images"), async () => {
                            const kubeletPrincipalId = await resolveClusterKubeletPrincipalId(
                                sessionProvider,
                                selection.subscriptionId,
                                selection.clusterResourceGroup,
                                selection.clusterName,
                            );
                            const client = getAuthorizationManagementClient(sessionProvider, selection.subscriptionId);
                            await grantAcrPull(
                                client,
                                selection.subscriptionId,
                                kubeletPrincipalId,
                                selection.acrResourceGroup,
                                selection.acrName,
                            );
                        });
                        stage.succeed(
                            l10n.t("{0} can now pull images from {1}.", selection.clusterName, selection.acrName),
                        );
                    } else {
                        stage.succeed(
                            l10n.t(
                                "{0} is already connected to {1}, so no permission changes are needed.",
                                selection.clusterName,
                                selection.acrName,
                            ),
                        );
                    }
                    return "continue";
                } catch (e) {
                    stage.fail(getErrorMessage(e));
                    return "halt";
                }
            },
        },
        {
            id: "verify",
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
                    timeoutMs: VERIFY_POLL_TIMEOUT_MS,
                    token,
                    onWait: (elapsedMs) =>
                        reportProgress(
                            l10n.t("Waiting for the role assignment to take effect… ({0})", formatElapsed(elapsedMs)),
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
        });
    }

    if (probeResult.allPassed) {
        stage.succeed(l10n.t("The cluster can pull images from the registry."));
    } else {
        stage.warn(
            l10n.t(
                "The cluster can't pull from the registry yet. Pods may fail to start until the AcrPull role is granted to the cluster's kubelet identity.",
            ),
        );
    }
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
        const elapsed = formatElapsed(performance.now() - start);
        try {
            const cluster = await aksClient.managedClusters.get(selections.resourceGroupName, selections.clusterName);
            progress.reportProgress(
                l10n.t("Cluster status: {0} ({1})", cluster.provisioningState ?? "Creating", elapsed),
            );
        } catch {
            progress.reportProgress(l10n.t("Waiting for the cluster to appear… ({0})", elapsed));
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
            onWait: (elapsedMs, state) =>
                progress?.reportProgress(
                    l10n.t("Cluster status: {0} ({1})", state ?? "Creating", formatElapsed(elapsedMs)),
                ),
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
): Promise<void> {
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
