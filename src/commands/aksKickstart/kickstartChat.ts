import * as vscode from "vscode";
import { GuidedSetupSelections, KickstartSample } from "../../webview-contract/webviewDefinitions/kickstartGuidedSetup";

// Must match `contributes.chatAgents[].name` in package.json: used as both the chat
// `mode` and the `@<name>` routing prefix when opening the agent.
export const KICKSTART_AGENT_NAME = "kickstart";

export const LAST_SUBSCRIPTION_KEY = "aks.kickstart.lastSubscriptionId";

export const KICKSTART_SAMPLES: KickstartSample[] = [
    {
        label: "AKS Store Demo",
        stack: "Node.js · Go · Rust",
        description: "Microservices — Node.js, Go, Rust + MongoDB + RabbitMQ",
        repoUrl: "https://github.com/Azure-Samples/aks-store-demo.git",
    },
    {
        label: "Azure Voting App",
        stack: "Python · Redis",
        description: "Two containers — Python/Flask + Redis",
        repoUrl: "https://github.com/Azure-Samples/azure-voting-app-redis.git",
    },
    {
        label: "Contoso Real Estate",
        stack: "Next.js · PostgreSQL",
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
    /**
     * Absolute path to a kubelogin binary the launch wizard already downloaded during cluster setup,
     * or null if it couldn't be fetched. Handed to the agent so it reuses this copy instead of running
     * `which kubelogin` / `az aks install-cli` (AKS Automatic disables local accounts, so kubelogin is
     * always required for cluster auth).
     */
    kubeloginPath: string | null;
}

export interface ClusterHandoffOptions {
    /**
     * When true, the cluster is still being created in the background (the handoff happened early,
     * right after the kubelet identity was granted AcrPull). The chat prose tells the agent to keep
     * working through the phases that don't need a ready cluster while the create + RBAC propagation
     * finish.
     */
    stillProvisioning?: boolean;
}

export async function handoffClusterToChat(
    info: ProvisionedClusterInfo,
    options: ClusterHandoffOptions = {},
): Promise<void> {
    await openMaximizedChat(false);
    await vscode.commands.executeCommand("workbench.action.chat.open", buildClusterChatOpenOptions(info, options));
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

function buildKubeloginInstruction(kubeloginPath: string): string {
    return (
        `kubelogin is already installed at \`${kubeloginPath}\` — the launch wizard downloaded it during cluster setup. ` +
        "Use this binary for AKS Automatic cluster authentication and add its parent directory to your PATH so " +
        "`kubectl`'s exec credential plugin can find it. Skip the `which kubelogin` check and do not run " +
        "`az aks install-cli` or otherwise download kubelogin again."
    );
}

function buildClusterChatOpenOptions(
    info: ProvisionedClusterInfo,
    options: ClusterHandoffOptions = {},
): Record<string, unknown> {
    const summary = buildClusterContextSummary(info);
    const stillProvisioning = options.stillProvisioning ?? false;

    const baseQuery = stillProvisioning
        ? [
              `@${KICKSTART_AGENT_NAME} The cluster and registry are being set up. Here's the infrastructure:`,
              "",
              summary,
              "",
              "The AKS Automatic cluster is still being created in the background (this can take several minutes), and its kubelet identity has already been granted AcrPull on the registry so the role assignment is propagating while we work. Don't wait for it — continue from Phase 3 (Design) using these exact resource names. Phases 3 and 4 (Design and Generate) don't need the cluster to be ready. Before pushing images and deploying in Phase 7, run the `/kickstart-cluster-status` check to confirm the cluster has finished provisioning.",
          ].join("\n")
        : [
              `@${KICKSTART_AGENT_NAME} The cluster and registry are ready. Here's the infrastructure that was provisioned:`,
              "",
              summary,
              "",
              "The AKS Automatic cluster and ACR exist and the registry is already attached to the cluster. Continue from Phase 3 (Design) using these exact resource names.",
          ].join("\n");

    const query = info.kubeloginPath ? `${baseQuery}\n\n${buildKubeloginInstruction(info.kubeloginPath)}` : baseQuery;

    const response = stillProvisioning
        ? `The cluster is being created in the background:\n\n${summary}\n\nLet's keep going while it finishes.`
        : `Provisioning is complete:\n\n${summary}\n\nLet's keep going.`;

    return {
        mode: KICKSTART_AGENT_NAME,
        isPartialQuery: false,
        previousRequests: [
            {
                request: "Set up my AKS Automatic cluster and container registry.",
                response,
            },
        ],
        query,
    };
}
