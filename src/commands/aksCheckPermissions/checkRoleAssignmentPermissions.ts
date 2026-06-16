import * as vscode from "vscode";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getAuthorizationManagementClient, listAll } from "../utils/arm";
import { getResourceGroups } from "../utils/resourceGroups";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { createGraphClient, getCurrentUserId } from "../utils/graph";
import {
    EligibleGrant,
    RBAC_ADMIN_ROLE,
    ROLE_CONTRIBUTOR,
    ROLE_OWNER,
    ROLE_RBAC_ADMINISTRATOR,
    ROLE_READER,
    ROLE_USER_ACCESS_ADMINISTRATOR,
    ROLE_ASSIGNMENT_WRITE,
    RoleAssignmentWriteVerdict,
    azRoleAssignmentCommand,
    canCreateRoleAssignmentsAtResourceGroup,
    findEligiblePimGrants,
} from "../utils/roleAssignments";
import { Errorable, failed } from "../utils/errorable";
import { openMarkdownReport } from "../utils/markdownReport";

const QUICKPICK_TITLE = "Check role-assignment permissions";

let outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("AKS Kickstart");
    }
    return outputChannel;
}

type PermissionsScope = {
    subscriptionId: string;
    subscriptionName: string;
    resourceGroup: string;
    resourceGroupScopeId: string;
};

const WELL_KNOWN_ROLE_NAMES: Record<string, string> = {
    [ROLE_OWNER]: "Owner",
    [ROLE_CONTRIBUTOR]: "Contributor",
    [ROLE_USER_ACCESS_ADMINISTRATOR]: "User Access Administrator",
    [ROLE_RBAC_ADMINISTRATOR]: "Role Based Access Control Administrator",
    [ROLE_READER]: "Reader",
};

/**
 * Args accepted when the command is invoked programmatically (e.g. from the Kickstart chat agent
 * via `vscode.commands.executeCommand`). When omitted, the user is prompted for scope.
 */
export type CheckRoleAssignmentPermissionsArgs = {
    subscriptionId?: string;
    /** Resource group name (NOT the full scope ID). */
    resourceGroup?: string;
    /** When true, suppresses the toast notification and skips opening the markdown document. */
    silent?: boolean;
};

/**
 * Result returned to programmatic callers. The Kickstart chat agent uses `markdown` to render
 * the report inline in the chat response.
 */
export type CheckRoleAssignmentPermissionsResult = {
    cancelled: boolean;
    canCreate?: boolean;
    /** Active role names resolved for the current user at/above the probed scope. */
    activeRoleNames?: string[];
    scope?: {
        subscriptionId: string;
        subscriptionName: string;
        resourceGroup: string;
        resourceGroupScopeId: string;
    };
    verdict?: RoleAssignmentWriteVerdict;
    eligiblePimRoles?: EligibleGrant[];
    /** Self-contained markdown report suitable for rendering in chat or opening as a document. */
    markdown?: string;
    /** Populated when the underlying Azure call failed. */
    error?: string;
};

export async function checkRoleAssignmentPermissions(
    _context: IActionContext | undefined,
    args?: CheckRoleAssignmentPermissionsArgs,
): Promise<CheckRoleAssignmentPermissionsResult> {
    const invokedProgrammatically = Boolean(args?.subscriptionId && args?.resourceGroup);
    const silent = args?.silent ?? invokedProgrammatically;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        if (!silent) vscode.window.showErrorMessage(sessionProvider.error);
        return { cancelled: false, error: sessionProvider.error };
    }

    const scope = invokedProgrammatically
        ? await resolveScopeFromArgs(sessionProvider.result, args!)
        : await pickScope(sessionProvider.result);
    if (!scope) return { cancelled: !invokedProgrammatically };
    if ("error" in scope) {
        if (!silent) vscode.window.showErrorMessage(scope.error);
        return { cancelled: false, error: scope.error };
    }

    const authClient = getAuthorizationManagementClient(sessionProvider.result, scope.subscriptionId);
    const verdictResult = await canCreateRoleAssignmentsAtResourceGroup(authClient, scope.resourceGroup);
    if (failed(verdictResult)) {
        const msg = `Failed to read effective permissions on '${scope.resourceGroup}': ${verdictResult.error}`;
        if (!silent) vscode.window.showErrorMessage(msg);
        return { cancelled: false, error: msg, scope };
    }

    const verdict = verdictResult.result;
    const activeRoleNames = await getActiveRoleNamesForCurrentUserAtScope(sessionProvider.result, authClient, scope);
    // Always attempt PIM lookup to ensure command always returns complete grants.
    // When user already has role-write permission, PIM data is still useful context.
    const channel = getOutputChannel();
    channel.appendLine(
        `[checkRoleAssignmentPermissions] canCreate=${verdict.canCreate} scope=${scope.resourceGroupScopeId}`,
    );
    channel.appendLine(`[checkRoleAssignmentPermissions] Starting PIM lookup at ${scope.resourceGroupScopeId}`);
    const eligible = await findEligiblePimGrants(authClient, scope.resourceGroupScopeId, (msg) =>
        channel.appendLine(msg),
    );
    if (failed(eligible)) {
        channel.appendLine(`[checkRoleAssignmentPermissions] PIM lookup failed: ${eligible.error}`);
    } else {
        channel.appendLine(
            `[checkRoleAssignmentPermissions] PIM lookup returned ${eligible.result.length} qualifying grant(s)`,
        );
        for (const g of eligible.result) {
            channel.appendLine(`  - ${g.roleName} at ${g.scopeId}`);
        }
    }

    const markdown = buildReport(scope, verdict, eligible);

    if (!silent) {
        await openMarkdownReport(markdown);
        const target = `${scope.subscriptionName} / ${scope.resourceGroup}`;
        if (verdict.canCreate) {
            vscode.window.showInformationMessage(`You can create role assignments on '${target}'.`);
        } else {
            vscode.window.showWarningMessage(
                `You cannot create role assignments on '${target}'. See report for options.`,
            );
        }
    }

    return {
        cancelled: false,
        canCreate: verdict.canCreate,
        activeRoleNames,
        scope,
        verdict,
        eligiblePimRoles: !failed(eligible) ? eligible.result : undefined,
        markdown,
    };
}

async function getActiveRoleNamesForCurrentUserAtScope(
    sessionProvider: ReadyAzureSessionProvider,
    authClient: ReturnType<typeof getAuthorizationManagementClient>,
    scope: PermissionsScope,
): Promise<string[] | undefined> {
    try {
        const graphClient = createGraphClient(sessionProvider);
        const userIdResult = await getCurrentUserId(graphClient);
        if (failed(userIdResult)) {
            return undefined;
        }

        // Do not use atScope(): inherited assignments from subscription/management group are
        // relevant to effective permissions at the resource-group scope.
        const assignments = await listAll(
            authClient.roleAssignments.listForScope(scope.resourceGroupScopeId, {
                filter: `assignedTo('${userIdResult.result}')`,
            }),
        );
        if (failed(assignments)) {
            return undefined;
        }

        const roleDefinitionIds = [
            ...new Set(
                assignments.result
                    .map((ra) => ra.roleDefinitionId?.split("/").pop())
                    .filter((id): id is string => Boolean(id)),
            ),
        ];
        if (roleDefinitionIds.length === 0) {
            return [];
        }

        const names: string[] = [];
        for (const id of roleDefinitionIds) {
            if (WELL_KNOWN_ROLE_NAMES[id]) {
                names.push(WELL_KNOWN_ROLE_NAMES[id]);
                continue;
            }
            try {
                const def = await authClient.roleDefinitions.get(`/subscriptions/${scope.subscriptionId}`, id);
                names.push(def.roleName ?? "Custom role");
            } catch {
                names.push("Custom role");
            }
        }

        return [...new Set(names)];
    } catch {
        return undefined;
    }
}

export function buildReport(
    scope: PermissionsScope,
    verdict: RoleAssignmentWriteVerdict,
    eligible: Errorable<EligibleGrant[]> | undefined,
): string {
    const header =
        `# Role-assignment permission check\n\n` +
        `**Scope:** \`${scope.resourceGroupScopeId}\`\n` +
        `**Action required:** \`${ROLE_ASSIGNMENT_WRITE}\`\n`;

    const body = verdict.canCreate ? renderGrantedSection(scope, verdict) : renderDeniedSection(scope, eligible);

    return `${header}\n${body}`;
}

function renderGrantedSection(scope: PermissionsScope, verdict: RoleAssignmentWriteVerdict): string {
    const matchedList = verdict.grantingActions.map((a) => `- \`${a}\``).join("\n");
    const sample = azRoleAssignmentCommand({
        assigneeObjectId: "<principal-id>",
        principalType: "ServicePrincipal",
        role: "<role>",
        scopeId: scope.resourceGroupScopeId,
    });
    return (
        `## ✅ You can create role assignments here\n\n` +
        `Your active role assignment(s) grant the required action via these patterns:\n\n` +
        `${matchedList}\n\n` +
        `Sample command (replace \`<principal-id>\` and \`<role>\`):\n\n` +
        `${sample}`
    );
}

function renderDeniedSection(scope: PermissionsScope, eligible: Errorable<EligibleGrant[]> | undefined): string {
    const sections: string[] = [`## ⚠️ You cannot create role assignments here\n`];

    sections.push(`No active role you hold at this scope grants the required action.\n`);
    sections.push(renderPimOption(eligible));
    sections.push(renderAdminHandoffOption(scope));
    return sections.join("\n");
}

function renderPimOption(eligible: Errorable<EligibleGrant[]> | undefined): string {
    const heading = `### Option A — Activate a PIM-eligible role\n`;

    if (!eligible) {
        return `${heading}\n_PIM eligibilities were not checked._\n`;
    }
    if (failed(eligible)) {
        return (
            `${heading}\n_Could not check PIM eligibilities: ${eligible.error}_\n\n` +
            `If your tenant uses Privileged Identity Management, open the Azure portal → ` +
            `**Privileged Identity Management** → **My roles** to see what you can activate.\n`
        );
    }
    if (eligible.result.length === 0) {
        return (
            `${heading}\n` +
            `You have **no PIM-eligible roles** at or above this scope that grant role-assignment write.\n`
        );
    }

    const bullets = eligible.result
        .map((g, i) => {
            const scopeLabel = g.scopeDisplayName ? `${g.scopeDisplayName} \`(${g.scopeId})\`` : `\`${g.scopeId}\``;
            const via = g.grantingAction ? ` — granted via \`${g.grantingAction}\`` : "";
            return `${i + 1}. **${g.roleName}** at ${scopeLabel}${via}`;
        })
        .join("\n");

    return (
        `${heading}\n` +
        `You have ${eligible.result.length} PIM-eligible role(s) that would grant the write once activated:\n\n` +
        `${bullets}\n\n` +
        `**To activate:** Azure portal → search **Privileged Identity Management** → **My roles** → ` +
        `**Eligible assignments** → select the role above → **Activate**. ` +
        `Allow ~30 s after activation for propagation.\n`
    );
}

function renderAdminHandoffOption(scope: PermissionsScope): string {
    const command = azRoleAssignmentCommand({
        assigneeObjectId: "<your-object-id>",
        principalType: "User",
        role: RBAC_ADMIN_ROLE,
        scopeId: scope.resourceGroupScopeId,
    });
    return (
        `### Option B — Ask an admin to assign you a role\n\n` +
        `Send an Owner / User Access Administrator / ${RBAC_ADMIN_ROLE} the command below. ` +
        `Replace \`<your-object-id>\` with your Entra ID object ID ` +
        `(run \`az ad signed-in-user show --query id -o tsv\`):\n\n` +
        `${command}\n` +
        `_\`${RBAC_ADMIN_ROLE}\` is the least-privilege built-in role that grants ` +
        `\`${ROLE_ASSIGNMENT_WRITE}\`. Prefer it over \`Owner\` or \`User Access Administrator\`._\n`
    );
}

async function resolveScopeFromArgs(
    sessionProvider: ReadyAzureSessionProvider,
    args: CheckRoleAssignmentPermissionsArgs,
): Promise<PermissionsScope | { error: string }> {
    const subs = await getSubscriptions(sessionProvider, SelectionType.AllIfNoFilters);
    if (failed(subs)) return { error: subs.error };

    const sub = subs.result.find((s) => s.subscriptionId === args.subscriptionId);
    if (!sub) {
        return { error: `Subscription '${args.subscriptionId}' is not accessible to the signed-in account.` };
    }

    return {
        subscriptionId: sub.subscriptionId,
        subscriptionName: sub.displayName,
        resourceGroup: args.resourceGroup!,
        resourceGroupScopeId: `/subscriptions/${sub.subscriptionId}/resourceGroups/${args.resourceGroup}`,
    };
}

async function pickScope(sessionProvider: ReadyAzureSessionProvider): Promise<PermissionsScope | undefined> {
    const subs = await getSubscriptions(sessionProvider, SelectionType.AllIfNoFilters);
    if (failed(subs)) {
        vscode.window.showErrorMessage(subs.error);
        return undefined;
    }
    if (subs.result.length === 0) {
        vscode.window.showWarningMessage("No Azure subscriptions found for the signed-in account.");
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
    if (rgs.result.length === 0) {
        vscode.window.showWarningMessage(`Subscription '${subPick.subscriptionName}' has no resource groups.`);
        return undefined;
    }

    const rgPick = await vscode.window.showQuickPick(
        rgs.result.map((rg) => ({ label: rg.name, description: rg.location })),
        { title: QUICKPICK_TITLE, placeHolder: "Select a resource group" },
    );
    if (!rgPick) return undefined;

    return {
        subscriptionId: subPick.subscriptionId,
        subscriptionName: subPick.subscriptionName,
        resourceGroup: rgPick.label,
        resourceGroupScopeId: `/subscriptions/${subPick.subscriptionId}/resourceGroups/${rgPick.label}`,
    };
}
