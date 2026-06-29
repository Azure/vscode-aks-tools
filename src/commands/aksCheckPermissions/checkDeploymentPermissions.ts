import * as vscode from "vscode";
import { AuthorizationManagementClient, Permission, RoleAssignment } from "@azure/arm-authorization";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getAuthorizationManagementClient, listAll } from "../utils/arm";
import { getResourceGroups } from "../utils/resourceGroups";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getManagedCluster } from "../utils/clusters";
import { acrResourceType, clusterResourceType, getResources } from "../utils/azureResources";
import {
    azRoleAssignmentCommand,
    findGrantingAction,
    getPrincipalRoleAssignmentsForAcr,
    getScopeForAcr,
    getScopeForCluster,
} from "../utils/roleAssignments";
import { Errorable, failed, getErrorMessage } from "../utils/errorable";
import { openMarkdownReport } from "../utils/markdownReport";

const QUICKPICK_TITLE = "Check AKS deployment permissions";

// Required actions for each gate in Phase 6 of the Kickstart agent.
export const AKS_CLUSTER_USER_ACTION = "Microsoft.ContainerService/managedClusters/listClusterUserCredential/action";
export const AKS_DATAPLANE_WRITE_ACTION = "Microsoft.ContainerService/managedClusters/apps/deployments/write";
// NOTE: despite the `*_DATAACTION` naming, Azure's built-in AcrPull/AcrPush roles grant these
// registry permissions as control-plane *actions* (their `dataActions` arrays are empty), and Azure
// can reclassify actions<->dataActions over time. Probes therefore match them via
// `grantsActionEitherBucket` rather than assuming a fixed bucket. Checking only `dataActions` was a
// false-negative: a valid AcrPull assignment was present but never matched, leaving a permanent
// "still propagating" warning that never cleared.
export const ACR_PULL_DATAACTION = "Microsoft.ContainerRegistry/registries/pull/read";
export const ACR_PUSH_DATAACTION = "Microsoft.ContainerRegistry/registries/push/write";
export const ACR_TASKS_ACTION = "Microsoft.ContainerRegistry/registries/tasks/write";

// Least-privilege built-in roles to recommend when a probe fails.
const ROLE_CLUSTER_USER = "Azure Kubernetes Service Cluster User Role";
const ROLE_RBAC_WRITER = "Azure Kubernetes Service RBAC Writer";
const ROLE_ACR_PULL = "AcrPull";
const ROLE_ACR_PUSH = "AcrPush";
const ROLE_ACR_TASKS = "Container Registry Tasks Contributor";

// Fixed role-definition GUID for the built-in AcrPull role. Azure built-in role IDs are immutable,
// so this lets us recognize an AcrPull assignment by ID even before its data actions have
// propagated through Azure AD (when the role-definition lookup can't yet confirm the grant).
const ACR_PULL_ROLE_DEFINITION_ID = "7f951dda-4ed3-4680-a7ca-43fe172d538d";

type DeploymentScope = {
    subscriptionId: string;
    subscriptionName: string;
    resourceGroup: string;
    clusterName: string;
    clusterScopeId: string;
    acrName?: string;
    acrScopeId?: string;
    acrResourceGroup?: string;
};

export type ProbeStatus = "pass" | "fail" | "unknown";

/**
 * Which probe set {@link runProbes} should execute:
 * - "all" (default): the signed-in user's runtime probes plus the kubelet ACR pull probe.
 * - "user": only the signed-in user's runtime probes (kubeconfig, workload deploy, image push, ACR build).
 * - "kubelet-pull": only the cluster kubelet's ACR pull probe.
 */
export type ProbeScope = "all" | "user" | "kubelet-pull";

export type Probe = {
    id: string;
    label: string;
    status: ProbeStatus;
    reason: string;
    /** Built-in role names that would satisfy this probe, ordered by least privilege. */
    recommendedRoles?: string[];
    /** A ready-to-run `az role assignment create` command for the first recommended role. */
    remediation?: string;
    /** Object ID of the principal this probe evaluated (e.g. the kubelet identity), for display. */
    principalId?: string;
};

export type CheckDeploymentPermissionsArgs = {
    subscriptionId?: string;
    resourceGroup?: string;
    clusterName?: string;
    /** Optional. When omitted, ACR-related probes are skipped. */
    acrName?: string;
    /** Optional. Resource group of the ACR when it differs from the cluster's resource group. */
    acrResourceGroup?: string;
    probeScope?: ProbeScope;
    /** When true, suppresses the toast and skips opening the markdown document. */
    silent?: boolean;
};

export type CheckDeploymentPermissionsResult = {
    cancelled: boolean;
    allPassed?: boolean;
    scope?: DeploymentScope;
    probes?: Probe[];
    /** Self-contained markdown report suitable for rendering in chat or opening as a document. */
    markdown?: string;
    error?: string;
};

export async function checkDeploymentPermissions(
    _context: IActionContext | undefined,
    args?: CheckDeploymentPermissionsArgs,
): Promise<CheckDeploymentPermissionsResult> {
    const invokedProgrammatically = Boolean(args?.subscriptionId && args?.resourceGroup && args?.clusterName);
    const silent = args?.silent ?? invokedProgrammatically;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        if (!silent) vscode.window.showErrorMessage(sessionProvider.error);
        return { cancelled: false, error: sessionProvider.error };
    }

    const scopeResult = invokedProgrammatically
        ? await resolveScopeFromArgs(sessionProvider.result, args!)
        : await pickScope(sessionProvider.result);
    if (!scopeResult) return { cancelled: !invokedProgrammatically };
    if ("error" in scopeResult) {
        if (!silent) vscode.window.showErrorMessage(scopeResult.error);
        return { cancelled: false, error: scopeResult.error };
    }
    const scope = scopeResult;

    const authClient = getAuthorizationManagementClient(sessionProvider.result, scope.subscriptionId);
    const probes = await runProbes(sessionProvider.result, authClient, scope, args?.probeScope ?? "all");
    const allPassed = probes.every((p) => p.status === "pass");
    const markdown = buildReport(scope, probes);

    if (!silent) {
        await openMarkdownReport(markdown);
        const target = `${scope.clusterName} (${scope.subscriptionName} / ${scope.resourceGroup})`;
        if (allPassed) {
            vscode.window.showInformationMessage(`All deployment permission checks passed for '${target}'.`);
        } else {
            const failing = probes.filter((p) => p.status !== "pass").length;
            vscode.window.showWarningMessage(
                `${failing} of ${probes.length} deployment permission check(s) need attention. See report.`,
            );
        }
    }

    return { cancelled: false, allPassed, scope, probes, markdown };
}

// ---------- Probes ----------

async function runProbes(
    sessionProvider: ReadyAzureSessionProvider,
    authClient: AuthorizationManagementClient,
    scope: DeploymentScope,
    probeScope: ProbeScope,
): Promise<Probe[]> {
    const includeUserProbes = probeScope === "all" || probeScope === "user";
    const includeKubeletProbe = probeScope === "all" || probeScope === "kubelet-pull";
    const probes: Probe[] = [];

    if (includeUserProbes) {
        const clusterPerms = await listForResource(authClient, scope.clusterScopeId);
        probes.push(evaluateClusterUserProbe(clusterPerms, scope));
        probes.push(evaluateDataPlaneWriteProbe(clusterPerms, scope));
    }

    if (!scope.acrName || !scope.acrScopeId) return probes;

    if (includeUserProbes) {
        const acrPerms = await listForResource(authClient, scope.acrScopeId);
        probes.push(evaluateAcrPushProbe(acrPerms, scope));
        probes.push(evaluateAcrTasksProbe(acrPerms, scope));
    }

    if (includeKubeletProbe) {
        const kubeletObjectId = await fetchKubeletObjectId(sessionProvider, scope);
        probes.push(await evaluateAcrPullProbe(authClient, scope, kubeletObjectId));
    }

    return probes;
}

function evaluateClusterUserProbe(perms: Errorable<Permission[]>, scope: DeploymentScope): Probe {
    return probeFromActionCheck({
        id: "cluster-user",
        label: `Download kubeconfig for cluster '${scope.clusterName}'`,
        perms,
        action: AKS_CLUSTER_USER_ACTION,
        kind: "action",
        scopeId: scope.clusterScopeId,
        recommendedRoles: [ROLE_CLUSTER_USER],
    });
}

function evaluateDataPlaneWriteProbe(perms: Errorable<Permission[]>, scope: DeploymentScope): Probe {
    return probeFromActionCheck({
        id: "aks-dataplane-write",
        label: `Create/update Kubernetes workloads on cluster '${scope.clusterName}'`,
        perms,
        action: AKS_DATAPLANE_WRITE_ACTION,
        kind: "dataAction",
        scopeId: scope.clusterScopeId,
        recommendedRoles: [ROLE_RBAC_WRITER],
    });
}

function evaluateAcrPushProbe(perms: Errorable<Permission[]>, scope: DeploymentScope): Probe {
    return probeFromActionCheck({
        id: "acr-push",
        label: `Push container images to ACR '${scope.acrName}'`,
        perms,
        action: ACR_PUSH_DATAACTION,
        kind: "action",
        scopeId: scope.acrScopeId!,
        recommendedRoles: [ROLE_ACR_PUSH],
    });
}

function evaluateAcrTasksProbe(perms: Errorable<Permission[]>, scope: DeploymentScope): Probe {
    return probeFromActionCheck({
        id: "acr-tasks",
        label: `Run server-side ACR builds (\`az acr build\`) on '${scope.acrName}'`,
        perms,
        action: ACR_TASKS_ACTION,
        kind: "action",
        scopeId: scope.acrScopeId!,
        recommendedRoles: [ROLE_ACR_TASKS],
    });
}

async function evaluateAcrPullProbe(
    authClient: AuthorizationManagementClient,
    scope: DeploymentScope,
    kubeletObjectId: Errorable<string>,
): Promise<Probe> {
    const probe: Probe = {
        id: "acr-pull-kubelet",
        label: `Cluster's kubelet identity can pull from ACR '${scope.acrName}'`,
        status: "unknown",
        reason: "",
        recommendedRoles: [ROLE_ACR_PULL],
    };

    if (failed(kubeletObjectId)) {
        probe.reason = `Could not look up the cluster's kubelet identity: ${kubeletObjectId.error}`;
        return probe;
    }

    probe.principalId = kubeletObjectId.result;

    const assignments = await getPrincipalRoleAssignmentsForAcr(
        authClient,
        kubeletObjectId.result,
        scope.acrResourceGroup ?? scope.resourceGroup,
        scope.acrName!,
    );
    if (failed(assignments)) {
        probe.reason = `Could not list role assignments on ACR: ${assignments.error}`;
        return probe;
    }

    let hasAcrPullAssignment = false;
    for (const ra of assignments.result) {
        if (isAcrPullRoleAssignment(ra)) hasAcrPullAssignment = true;
        const grants = await roleAssignmentGrantsAcrPull(authClient, ra, ACR_PULL_DATAACTION);
        if (grants) {
            probe.status = "pass";
            probe.reason = `Kubelet identity has an assignment that grants \`${ACR_PULL_DATAACTION}\`.`;
            return probe;
        }
    }

    // An AcrPull assignment exists for the kubelet identity, but its role definition couldn't be
    // read to confirm the grant (a transient lookup failure, or a brand-new assignment that hasn't
    // replicated through Azure AD yet). Surface it as a soft "still confirming" signal ("unknown")
    // instead of a hard fail, and omit the re-assign remediation since the role is already assigned.
    if (hasAcrPullAssignment) {
        probe.status = "unknown";
        probe.reason = `The kubelet identity has an AcrPull assignment, but the grant couldn't be confirmed yet — a brand-new assignment can take a few minutes to replicate through Azure AD.`;
        return probe;
    }

    probe.status = "fail";
    probe.reason = `No AcrPull role assignment that grants \`${ACR_PULL_DATAACTION}\` is visible on this ACR for the kubelet identity yet. If it was just assigned, it can take a few minutes to appear.`;
    probe.remediation = azRoleAssignmentCommand({
        assigneeObjectId: kubeletObjectId.result,
        principalType: "ServicePrincipal",
        role: ROLE_ACR_PULL,
        scopeId: scope.acrScopeId!,
    });
    return probe;
}

function probeFromActionCheck(input: {
    id: string;
    label: string;
    perms: Errorable<Permission[]>;
    action: string;
    kind: "action" | "dataAction";
    scopeId: string;
    recommendedRoles: string[];
}): Probe {
    const probe: Probe = {
        id: input.id,
        label: input.label,
        status: "unknown",
        reason: "",
        recommendedRoles: input.recommendedRoles,
    };

    if (failed(input.perms)) {
        probe.reason = `Could not read effective permissions: ${input.perms.error}`;
        return probe;
    }

    const verdict = grantsActionEitherBucket(input.perms.result, input.action);
    if (verdict.granted) {
        probe.status = "pass";
        probe.reason = `Granted via \`${verdict.via!}\`.`;
        return probe;
    }

    probe.status = "fail";
    probe.reason = `No active role you hold at this scope grants \`${input.action}\`${input.kind === "dataAction" ? " (data action)" : ""}.`;
    probe.remediation = azRoleAssignmentCommand({
        assigneeObjectId: "<your-object-id>",
        principalType: "User",
        role: input.recommendedRoles[0],
        scopeId: input.scopeId,
    });
    return probe;
}

/**
 * True iff `perms` grant `action` in EITHER the `actions` or `dataActions` bucket. Azure classifies
 * some Container Registry permissions (AcrPull's `registries/pull/read`, AcrPush's
 * `registries/push/write`) as control-plane actions despite their data-plane nature, and can
 * reclassify actions<->dataActions over time, so we accept a match in either bucket rather than
 * hard-coding which one applies.
 */
function grantsActionEitherBucket(perms: Permission[], action: string): { granted: boolean; via?: string } {
    const asAction = findGrantingAction(perms, action, "action");
    return asAction.granted ? asAction : findGrantingAction(perms, action, "dataAction");
}

async function roleAssignmentGrantsAcrPull(
    authClient: AuthorizationManagementClient,
    assignment: RoleAssignment,
    pullAction: string,
): Promise<boolean> {
    if (!assignment.roleDefinitionId) return false;
    try {
        const def = await authClient.roleDefinitions.getById(assignment.roleDefinitionId);
        return grantsActionEitherBucket(def.permissions ?? [], pullAction).granted;
    } catch {
        return false;
    }
}

/**
 * True when the role assignment references the built-in AcrPull role (matched by its fixed
 * role-definition GUID). Unlike {@link roleAssignmentGrantsAcrPull} this is a pure string check
 * with no network call, so it still recognizes the assignment when the role-definition lookup hasn't
 * propagated yet — letting the probe distinguish "assigned, still propagating" from "absent".
 */
function isAcrPullRoleAssignment(assignment: RoleAssignment): boolean {
    return assignment.roleDefinitionId?.toLowerCase().endsWith(`/${ACR_PULL_ROLE_DEFINITION_ID}`) ?? false;
}

async function listForResource(
    authClient: AuthorizationManagementClient,
    resourceScopeId: string,
): Promise<Errorable<Permission[]>> {
    // Parsed: /subscriptions/{sub}/resourceGroups/{rg}/providers/{ns}/{type}/{name}
    const parts = resourceScopeId.split("/");
    const rg = parts[4];
    const namespace = parts[6];
    const type = parts[7];
    const name = parts[8];
    try {
        return await listAll(authClient.permissions.listForResource(rg, namespace, "", type, name));
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

async function fetchKubeletObjectId(
    sessionProvider: ReadyAzureSessionProvider,
    scope: DeploymentScope,
): Promise<Errorable<string>> {
    const cluster = await getManagedCluster(
        sessionProvider,
        scope.subscriptionId,
        scope.resourceGroup,
        scope.clusterName,
    );
    if (failed(cluster)) return cluster;
    const kubeletObjectId = cluster.result.identityProfile?.kubeletidentity?.objectId;
    if (!kubeletObjectId) {
        return {
            succeeded: false,
            error: "Cluster has no kubelet identity (service-principal clusters are not supported by this probe).",
        };
    }
    return { succeeded: true, result: kubeletObjectId };
}

// ---------- Report ----------

function buildReport(scope: DeploymentScope, probes: Probe[]): string {
    const passCount = probes.filter((p) => p.status === "pass").length;
    const failCount = probes.filter((p) => p.status === "fail").length;
    const unknownCount = probes.filter((p) => p.status === "unknown").length;

    const acrLine = scope.acrScopeId
        ? `**ACR:** \`${scope.acrScopeId}\`\n`
        : `**ACR:** _(not provided — ACR probes skipped)_\n`;
    const header =
        `# AKS deployment permission check\n\n` +
        `**Cluster:** \`${scope.clusterScopeId}\`\n` +
        `${acrLine}` +
        `\n**Summary:** ${passCount} pass · ${failCount} fail · ${unknownCount} unknown\n`;

    const rows = probes.map(renderProbeSection).join("\n");
    const footer = failCount + unknownCount > 0 ? renderFooter() : "";
    return `${header}\n${rows}${footer}`;
}

function renderProbeSection(probe: Probe): string {
    const icon = probe.status === "pass" ? "✅" : probe.status === "fail" ? "❌" : "⚠️";
    const lines = [`## ${icon} ${probe.label}\n`, `${probe.reason}\n`];

    if (probe.status !== "pass" && probe.recommendedRoles?.length) {
        const roles = probe.recommendedRoles.map((r) => `\`${r}\``).join(" or ");
        lines.push(`**Recommended role(s):** ${roles}\n`);
    }
    if (probe.remediation) {
        lines.push(`**Remediation:**\n\n${probe.remediation}`);
    }
    return `${lines.join("\n")}\n`;
}

function renderFooter(): string {
    return (
        `---\n\n` +
        `_If \`az role assignment create\` returns 403, run the **AKS: Check Role Assignment Permissions** ` +
        `command (or invoke \`aks.checkRoleAssignmentPermissions\` programmatically) to check for PIM-eligible ` +
        `roles and generate an admin hand-off block._\n`
    );
}

// ---------- Scope picker / arg resolver ----------

async function resolveScopeFromArgs(
    sessionProvider: ReadyAzureSessionProvider,
    args: CheckDeploymentPermissionsArgs,
): Promise<DeploymentScope | { error: string }> {
    const subs = await getSubscriptions(sessionProvider, SelectionType.AllIfNoFilters);
    if (failed(subs)) return { error: subs.error };
    const sub = subs.result.find((s) => s.subscriptionId === args.subscriptionId);
    if (!sub) return { error: `Subscription '${args.subscriptionId}' is not accessible.` };

    const clusterScopeId = getScopeForCluster(sub.subscriptionId, args.resourceGroup!, args.clusterName!);
    const acrResourceGroup = args.acrResourceGroup ?? args.resourceGroup!;
    const acrScopeId = args.acrName ? getScopeForAcr(sub.subscriptionId, acrResourceGroup, args.acrName) : undefined;

    return {
        subscriptionId: sub.subscriptionId,
        subscriptionName: sub.displayName,
        resourceGroup: args.resourceGroup!,
        clusterName: args.clusterName!,
        clusterScopeId,
        acrName: args.acrName,
        acrScopeId,
        acrResourceGroup: args.acrName ? acrResourceGroup : undefined,
    };
}

async function pickScope(sessionProvider: ReadyAzureSessionProvider): Promise<DeploymentScope | undefined> {
    const subs = await getSubscriptions(sessionProvider, SelectionType.AllIfNoFilters);
    if (failed(subs)) {
        vscode.window.showErrorMessage(subs.error);
        return undefined;
    }
    const subPick = await vscode.window.showQuickPick(
        subs.result.map((s) => ({
            label: s.displayName,
            description: s.subscriptionId,
            subscriptionId: s.subscriptionId,
            subscriptionName: s.displayName,
        })),
        { title: QUICKPICK_TITLE, placeHolder: "Select a subscription" },
    );
    if (!subPick) return undefined;

    const rgs = await getResourceGroups(sessionProvider, subPick.subscriptionId);
    if (failed(rgs)) {
        vscode.window.showErrorMessage(rgs.error);
        return undefined;
    }
    const rgPick = await vscode.window.showQuickPick(
        rgs.result.map((rg) => ({ label: rg.name, description: rg.location })),
        { title: QUICKPICK_TITLE, placeHolder: "Select a resource group" },
    );
    if (!rgPick) return undefined;

    const clusters = await getResources(sessionProvider, subPick.subscriptionId, clusterResourceType);
    if (failed(clusters)) {
        vscode.window.showErrorMessage(clusters.error);
        return undefined;
    }
    const clustersInRg = clusters.result.filter((c) => c.resourceGroup.toLowerCase() === rgPick.label.toLowerCase());
    if (clustersInRg.length === 0) {
        vscode.window.showWarningMessage(`Resource group '${rgPick.label}' has no AKS clusters.`);
        return undefined;
    }
    const clusterPick = await vscode.window.showQuickPick(
        clustersInRg.map((c) => ({ label: c.name, description: c.location })),
        { title: QUICKPICK_TITLE, placeHolder: "Select an AKS cluster" },
    );
    if (!clusterPick) return undefined;

    const acrs = await getResources(sessionProvider, subPick.subscriptionId, acrResourceType);
    const acrChoices = failed(acrs)
        ? []
        : acrs.result.map((a) => ({ label: a.name, description: `${a.resourceGroup} · ${a.location}`, acr: a }));
    const acrPick = await vscode.window.showQuickPick(
        [{ label: "$(circle-slash) Skip ACR checks", description: "" }, ...acrChoices],
        { title: QUICKPICK_TITLE, placeHolder: "Select an ACR (or skip)" },
    );
    if (!acrPick) return undefined;

    const acrName = "acr" in acrPick ? acrPick.acr.name : undefined;
    const acrResourceGroup = "acr" in acrPick ? acrPick.acr.resourceGroup : undefined;

    return {
        subscriptionId: subPick.subscriptionId,
        subscriptionName: subPick.subscriptionName,
        resourceGroup: rgPick.label,
        clusterName: clusterPick.label,
        clusterScopeId: getScopeForCluster(subPick.subscriptionId, rgPick.label, clusterPick.label),
        acrName,
        acrScopeId:
            acrName && acrResourceGroup ? getScopeForAcr(subPick.subscriptionId, acrResourceGroup, acrName) : undefined,
        acrResourceGroup: acrName ? acrResourceGroup : undefined,
    };
}
