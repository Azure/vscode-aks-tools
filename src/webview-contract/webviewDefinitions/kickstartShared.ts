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

export interface RoleSummary {
    roleNames: string[];
    canAssignRoles: boolean;
    canAssignRolesKnown: boolean;
    detail: string;
}
