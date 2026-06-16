export interface Subscription {
    id: string;
    name: string;
    tenantId: string;
}

export interface ResourceGroup {
    name: string;
    location: string;
}

export type SetupStepStatus = "pending" | "running" | "succeeded" | "warning" | "failed";

export interface SetupStep {
    id: string;
    title: string;
    status: SetupStepStatus;
    detail?: string;
}

export type ActivityFlow = "subscriptionScan" | "preflight" | "provision";

export type ActivityStatus = "running" | "succeeded" | "warning" | "failed" | "cancelled";

export interface ActivityEntry {
    action: string;
    status: ActivityStatus;
    elapsedMs?: number;
    detail?: string;
    /** Optional URL — renders the action label as a clickable link. */
    url?: string;
}

export interface ActivitySnapshot {
    flow: ActivityFlow;
    runId: number;
    stage: string;
    title: string;
    status: SetupStepStatus;
    entries: ActivityEntry[];
    detail?: string;
}

export interface RegionQuotaResult {
    location: string;
    status: SetupStepStatus;
    detail: string;
    hasQuota: boolean;
}

export interface PimEligibleGrant {
    roleName: string;
    /** Scope at which the eligibility was found (sub or RG). Display name preferred when known. */
    scopeDisplayName: string;
}

export interface RoleSummary {
    roleNames: string[];
    canAssignRoles: boolean;
    canAssignRolesKnown: boolean;
    detail: string;
    /**
     * PIM-eligible roles the caller could activate to satisfy the role-assignment-write check.
     * Only populated when the active verdict is denied or unknown.
     */
    eligiblePimGrants?: PimEligibleGrant[];
    /**
     * Diagnostic for when the PIM lookup ran but yielded nothing useful. Populated only when the
     * active verdict was denied/unknown so we attempted PIM, and either the list call failed or
     * returned no grants that would unblock role assignment. Empty string when the lookup
     * succeeded with no qualifying grants; non-empty string carries the error message.
     */
    pimLookupNote?: string;
    /**
     * Actionable warning banner shown when role assignment permission is denied and no PIM roles are available.
     * Includes guidance on how to request access or contact an admin.
     */
    actionBanner?: {
        message: string;
        actionText: string;
        actionUrl?: string;
        nextSteps?: string[];
    };
}

export interface DeploymentActionResult {
    /** Human-readable label, e.g. "Create AKS cluster". */
    label: string;
    /** ARM action probed, e.g. "Microsoft.ContainerService/managedClusters/write". */
    action: string;
    granted: boolean;
}

export interface DeploymentPermissionsSummary {
    /** False when the permissions lookup failed; both `actions` and `allGranted` should be ignored. */
    known: boolean;
    allGranted: boolean;
    actions: DeploymentActionResult[];
    detail: string;
}
