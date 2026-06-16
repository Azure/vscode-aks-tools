import * as vscode from "vscode";
import { GuidedSetupSelections, KickstartSample } from "../../webview-contract/webviewDefinitions/kickstartGuidedSetup";

// Must match `contributes.chatAgents[].name` in package.json: used as both the chat
// `mode` and the `@<name>` routing prefix when opening the agent.
export const KICKSTART_AGENT_NAME = "kickstart";

export const LAST_SUBSCRIPTION_KEY = "aks.kickstart.lastSubscriptionId";

export const KICKSTART_SAMPLES: KickstartSample[] = [
    {
        label: "AKS Store Demo",
        description: "Microservices — Node.js, Go, Rust + MongoDB + RabbitMQ",
        repoUrl: "https://github.com/Azure-Samples/aks-store-demo.git",
    },
    {
        label: "Azure Voting App",
        description: "Two containers — Python/Flask + Redis",
        repoUrl: "https://github.com/Azure-Samples/azure-voting-app-redis.git",
    },
    {
        label: "Contoso Real Estate",
        description: "Full-stack JavaScript — Next.js + Fastify + PostgreSQL",
        repoUrl: "https://github.com/Azure-Samples/contoso-real-estate.git",
    },
];

export async function handoffToChat(selections: GuidedSetupSelections): Promise<void> {
    await openMaximizedChat(true);
    await vscode.commands.executeCommand("workbench.action.chat.open", buildChatOpenOptions(selections));
}

async function openMaximizedChat(startNewChat: boolean): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.closePanel");
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("workbench.action.chat.open", {
        mode: KICKSTART_AGENT_NAME,
        query: "",
        isPartialQuery: true,
    });
    await vscode.commands.executeCommand("workbench.action.maximizeAuxiliaryBar");
    if (startNewChat) {
        await vscode.commands.executeCommand("workbench.action.chat.newChat");
    }
}

function buildContextSummary(selections: GuidedSetupSelections): string {
    const lines: string[] = [];

    switch (selections.appSource.kind) {
        case "repo":
            lines.push("- **Starting point:** existing GitHub repository");
            lines.push(`- **Repository URL:** ${selections.appSource.repoUrl}`);
            break;
        case "new":
            lines.push("- **Starting point:** build something new");
            if (selections.appSource.projectType) {
                lines.push(`- **Project type:** ${selections.appSource.projectType}`);
            }
            if (selections.appSource.language) {
                lines.push(`- **Language / framework:** ${selections.appSource.language}`);
            }
            if (selections.appSource.projectIdea) {
                lines.push(`- **App idea:** ${selections.appSource.projectIdea}`);
            }
            break;
        case "sample":
            lines.push("- **Starting point:** example sample");
            lines.push(`- **Sample:** ${selections.appSource.sampleLabel} (${selections.appSource.sampleRepoUrl})`);
            break;
        case "workspace":
            lines.push("- **Starting point:** the current VS Code workspace");
            break;
    }

    return lines.join("\n");
}

function buildChatOpenOptions(selections: GuidedSetupSelections): Record<string, unknown> {
    const summary = buildContextSummary(selections);

    // Redundant seeding for cross-version reliability: `mode` + `previousRequests` is the
    // modern path, while the `@<name>` prefix and the summary embedded in `query` keep
    // working on older VS Code builds. Don't collapse these — they cover different builds.
    const query = [
        `@${KICKSTART_AGENT_NAME} Let's get started. I made these choices in the launch wizard:`,
        "",
        summary,
        "",
        "Use these selections and skip any questions they already answer.",
        "",
        "Once you understand the app's requirements, launch the cluster-and-registry setup by running the `aks.kickstartCluster` command — don't choose a subscription or run `az aks create` yourself. Wait for that view to provision the cluster and registry and report the resource names back here before continuing.",
    ].join("\n");

    return {
        mode: KICKSTART_AGENT_NAME,
        isPartialQuery: false,
        previousRequests: [
            {
                request: "Start AKS Kickstart with the setup I selected in the launch wizard.",
                response: `Here's the setup I'll use:\n\n${summary}\n\nLet's begin.`,
            },
        ],
        query,
    };
}

export interface ProvisionedClusterInfo {
    subscriptionName: string;
    subscriptionId: string;
    resourceGroupName: string;
    clusterName: string;
    clusterPortalUrl: string | null;
    acrName: string;
    acrLoginServer: string | null;
}

export async function handoffClusterToChat(info: ProvisionedClusterInfo): Promise<void> {
    await openMaximizedChat(false);
    await vscode.commands.executeCommand("workbench.action.chat.open", buildClusterChatOpenOptions(info));
}

function buildClusterContextSummary(info: ProvisionedClusterInfo): string {
    const registry = info.acrLoginServer ? `${info.acrName} (${info.acrLoginServer})` : info.acrName;
    const lines = [
        `- **Subscription:** ${info.subscriptionName}`,
        `- **Subscription ID:** ${info.subscriptionId}`,
        `- **Resource group:** ${info.resourceGroupName}`,
        `- **AKS Automatic cluster:** ${info.clusterName}`,
        `- **Container registry:** ${registry}`,
    ];
    if (info.clusterPortalUrl) {
        lines.push(`- **Azure portal:** ${info.clusterPortalUrl}`);
    }
    return lines.join("\n");
}

function buildClusterChatOpenOptions(info: ProvisionedClusterInfo): Record<string, unknown> {
    const summary = buildClusterContextSummary(info);

    const query = [
        `@${KICKSTART_AGENT_NAME} The cluster and registry are ready. Here's the infrastructure that was provisioned:`,
        "",
        summary,
        "",
        "The AKS Automatic cluster and ACR exist and the registry is already attached to the cluster. Continue from Phase 3 (Design) using these exact resource names.",
    ].join("\n");

    return {
        mode: KICKSTART_AGENT_NAME,
        isPartialQuery: false,
        previousRequests: [
            {
                request: "Set up my AKS Automatic cluster and container registry.",
                response: `Provisioning is complete:\n\n${summary}\n\nLet's keep going.`,
            },
        ],
        query,
    };
}
