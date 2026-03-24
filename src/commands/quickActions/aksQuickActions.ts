import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as l10n from "@vscode/l10n";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAksClusterSubscriptionNode, getAksClusterTreeNode } from "../utils/clusters";
import { succeeded } from "../utils/errorable";

type CommandId =
    | "aks.aksRunKubectlCommands"
    | "aks.aksSetupMCPServerCommands"
    | "aks.clusterProperties"
    | "aks.showInPortal"
    | "aks.clusterFilter";

type UsageStats = Record<CommandId, { count: number; lastUsed: number }>;

type QuickActionItem = vscode.QuickPickItem & {
    commandId?: CommandId;
    args?: unknown[];
};

const usageStateKey = "aks.quickActions.usage";
let usageStore: vscode.Memento | undefined;

const clusterCommandDefaults: Array<{ commandId: CommandId; label: string; description: string; detail: string }> = [
    {
        commandId: "aks.aksRunKubectlCommands",
        label: l10n.t("Run Kubectl Commands"),
        description: l10n.t("Most used"),
        detail: l10n.t("Run ad-hoc kubectl commands against this cluster."),
    },
    {
        commandId: "aks.clusterProperties",
        label: l10n.t("Show Properties"),
        description: l10n.t("Most used"),
        detail: l10n.t("Inspect cluster metadata and operations."),
    },
    {
        commandId: "aks.showInPortal",
        label: l10n.t("Show In Azure Portal"),
        description: l10n.t("Most used"),
        detail: l10n.t("Open this AKS cluster in the Azure portal."),
    },
    {
        commandId: "aks.aksSetupMCPServerCommands",
        label: l10n.t("Setup AKS MCP Server"),
        description: l10n.t("Recommended"),
        detail: l10n.t("Configure the AKS MCP server in your VS Code user settings."),
    },
];

const subscriptionCommandDefaults: Array<{ commandId: CommandId; label: string; description: string; detail: string }> =
    [
        {
            commandId: "aks.clusterFilter",
            label: l10n.t("Select cluster..."),
            description: l10n.t("Most used"),
            detail: l10n.t("Filter visible AKS clusters for this subscription."),
        },
    ];

export function initializeQuickActions(context: vscode.ExtensionContext): void {
    usageStore = context.globalState;
}

export async function aksQuickActions(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (!cloudExplorer.available) {
        vscode.window.showErrorMessage(l10n.t("Cloud explorer is unavailable."));
        return;
    }

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);

    const items = succeeded(clusterNode)
        ? await getClusterQuickActionItems(target)
        : succeeded(subscriptionNode)
          ? getSubscriptionQuickActionItems(target)
          : undefined;

    if (!items) {
        vscode.window.showInformationMessage(
            l10n.t("Quick Actions are available on AKS cluster and subscription nodes."),
        );
        return;
    }

    const selected = await vscode.window.showQuickPick(items, {
        title: l10n.t("AKS Quick Actions"),
        placeHolder: l10n.t("Choose a frequently used action"),
    });

    if (!selected?.commandId) {
        return;
    }

    await vscode.commands.executeCommand(selected.commandId, ...(selected.args ?? [target]));
    await markCommandUsed(selected.commandId);
}

async function getClusterQuickActionItems(target: unknown): Promise<QuickActionItem[]> {
    const usage = getUsageStats();
    const sorted = [...clusterCommandDefaults].sort(
        (a, b) => getCommandScore(b.commandId, usage) - getCommandScore(a.commandId, usage),
    );

    const withArgs = sorted.map((item) => {
        return { ...item, args: [target] };
    });

    const mostUsed = withArgs.filter((item) => (usage[item.commandId]?.count || 0) > 0).slice(0, 3);
    const recommended = withArgs.filter((item) => ["aks.aksSetupMCPServerCommands"].includes(item.commandId));
    const moreActions = withArgs.filter(
        (item) =>
            !mostUsed.some((used) => used.commandId === item.commandId) &&
            !recommended.some((rec) => rec.commandId === item.commandId),
    );

    const topItems: QuickActionItem[] = [];

    if (mostUsed.length > 0) {
        topItems.push({
            label: l10n.t("Most used"),
            kind: vscode.QuickPickItemKind.Separator,
        });
        topItems.push(...mostUsed);
    }

    if (recommended.length > 0) {
        topItems.push({
            label: l10n.t("Recommended"),
            kind: vscode.QuickPickItemKind.Separator,
        });
        topItems.push(...recommended);
    }

    if (moreActions.length > 0) {
        topItems.push({
            label: l10n.t("More actions"),
            kind: vscode.QuickPickItemKind.Separator,
        });
        topItems.push(...moreActions);
    }

    return topItems;
}

function getSubscriptionQuickActionItems(target: unknown): QuickActionItem[] {
    return subscriptionCommandDefaults.map((item) => ({ ...item, args: [target] }));
}

function getUsageStats(): UsageStats {
    if (!usageStore) {
        return {} as UsageStats;
    }

    return usageStore.get<UsageStats>(usageStateKey, {} as UsageStats);
}

async function markCommandUsed(commandId: CommandId): Promise<void> {
    if (!usageStore) {
        return;
    }

    const now = Date.now();
    const existing = getUsageStats();
    const current = existing[commandId];
    const updated: UsageStats = {
        ...existing,
        [commandId]: {
            count: (current?.count || 0) + 1,
            lastUsed: now,
        },
    };

    await usageStore.update(usageStateKey, updated);
}

function getCommandScore(commandId: CommandId, usage: UsageStats): number {
    const stats = usage[commandId];
    if (!stats) {
        return 0;
    }

    const recencyDays = (Date.now() - stats.lastUsed) / (1000 * 60 * 60 * 24);
    const recency = Math.max(0, 1 - recencyDays / 30);
    return 0.65 * stats.count + 0.35 * recency;
}
