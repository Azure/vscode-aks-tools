import * as vscode from "vscode";
import { LMClient } from "../../commands/aksContainerAssist/lmClient";
import { failed } from "../../commands/utils/errorable";
import { useWorkspace } from "../../commands/aksKickstart/repoSource";
import { AcrKey, ClusterKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { reportKickstartTelemetry } from "./telemetry";
import { analyzeProject } from "./steps/analyze";
import { generateDockerfileStep } from "./steps/dockerfile";
import { generateManifestsStep } from "./steps/manifests";
import { generateGithubActionsStep } from "./steps/githubActions";
import { configureKickstart } from "../../commands/aksKickstart/configure";
import { StagedFileManager } from "./stagedFileManager";
import { StagedFile } from "./state";

export interface KickstartOptions {
    projectPath: string;
    clusterKey?: ClusterKey;
    acrKey?: AcrKey;
    acrLoginServer?: string;
    clusterName?: string;
    resourceGroup?: string;
    isAutomatic?: boolean;
    canGetKubeconfig?: boolean;
    hasAcrPull?: boolean;
}

export interface KickstartResult {
    metadata: {
        command: string;
        artifactCount?: number;
        projectPath?: string;
        cancelled?: boolean;
        error?: string;
    };
}

export async function handleStart(
    _request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    options?: Partial<KickstartOptions>,
    storageUri?: vscode.Uri,
): Promise<KickstartResult> {
    if (isCancelled(token, stream)) {
        reportKickstartTelemetry("start.cancelled");
        return { metadata: { command: "start", cancelled: true } };
    }

    const projectPathResult = options?.projectPath
        ? { succeeded: true as const, result: options.projectPath }
        : await useWorkspace();
    if (failed(projectPathResult)) {
        stream.markdown(`**Error:** ${projectPathResult.error}`);
        reportKickstartTelemetry("start.error", { error: "workspace_unavailable" });
        return { metadata: { command: "start", error: projectPathResult.error } };
    }

    const projectPath = projectPathResult.result;

    if (!options?.clusterKey) {
        stream.progress("Configuring cluster and registry...");
        const configResult = await configureKickstart();
        if (failed(configResult)) {
            if (configResult.error === "Cancelled.") {
                reportKickstartTelemetry("start.cancelled");
                return { metadata: { command: "start", cancelled: true } };
            }
            stream.markdown(`**Error:** ${configResult.error}`);
            reportKickstartTelemetry("start.error", { error: "configure_failed" });
            return { metadata: { command: "start", error: configResult.error } };
        }

        options = {
            ...options,
            projectPath,
            clusterKey: configResult.result.clusterKey,
            acrKey: configResult.result.acrKey,
            acrLoginServer: configResult.result.acrLoginServer,
            clusterName: configResult.result.clusterName,
            resourceGroup: configResult.result.resourceGroup,
            isAutomatic: configResult.result.isAutomatic,
            canGetKubeconfig: configResult.result.canGetKubeconfig,
            hasAcrPull: configResult.result.hasAcrPull,
        };
    }

    renderPreflightChecks(stream, options);

    const lmClient = new LMClient();
    const modelResult = await lmClient.ensureModel();
    if (failed(modelResult)) {
        const error = "GitHub Copilot is required. Please install the Copilot extension.";
        stream.markdown(`**Error:** ${error}`);
        reportKickstartTelemetry("start.error", { error: "model_unavailable" });
        return { metadata: { command: "start", projectPath, error } };
    }

    if (isCancelled(token, stream)) {
        reportKickstartTelemetry("start.cancelled");
        return { metadata: { command: "start", cancelled: true } };
    }
    stream.progress("Analyzing project...");
    const analysis = await analyzeProject(projectPath, lmClient, token);
    if (failed(analysis)) {
        stream.markdown(`**Error:** ${analysis.error}`);
        reportKickstartTelemetry("start.error", { error: "analysis_failed" });
        return { metadata: { command: "start", projectPath, error: analysis.error } };
    }

    if (isCancelled(token, stream)) {
        reportKickstartTelemetry("start.cancelled");
        return { metadata: { command: "start", cancelled: true } };
    }
    stream.progress("Generating Dockerfile...");
    const stagedManager = new StagedFileManager(storageUri ?? vscode.Uri.file(projectPath));
    const stagedSoFar: StagedFile[] = [];
    const noopOnFileStaged = (_file: StagedFile, allStaged: StagedFile[]) => {
        stagedSoFar.length = 0;
        stagedSoFar.push(...allStaged);
    };

    const dockerfileResult = await generateDockerfileStep(
        analysis.result,
        lmClient,
        stream,
        token,
        projectPath,
        stagedManager,
        stagedSoFar,
        noopOnFileStaged,
    );
    if (failed(dockerfileResult)) {
        stream.markdown(`**Error:** ${dockerfileResult.error}`);
        reportKickstartTelemetry("start.error", { error: "dockerfile_failed" });
        return { metadata: { command: "start", projectPath, error: dockerfileResult.error } };
    }

    if (isCancelled(token, stream)) {
        reportKickstartTelemetry("start.cancelled");
        return { metadata: { command: "start", cancelled: true } };
    }
    stream.progress("Generating Kubernetes manifests...");
    const manifestsResult = await generateManifestsStep(
        analysis.result,
        dockerfileResult,
        lmClient,
        stream,
        token,
        projectPath,
        stagedManager,
        stagedSoFar,
        noopOnFileStaged,
        options,
    );
    if (failed(manifestsResult)) {
        stream.markdown(`**Error:** ${manifestsResult.error}`);
        reportKickstartTelemetry("start.error", { error: "manifests_failed" });
        return { metadata: { command: "start", projectPath, error: manifestsResult.error } };
    }

    if (isCancelled(token, stream)) {
        reportKickstartTelemetry("start.cancelled");
        return { metadata: { command: "start", cancelled: true } };
    }
    stream.progress("Generating GitHub Actions workflow...");
    const githubActionsResult = await generateGithubActionsStep(
        analysis.result,
        lmClient,
        stream,
        token,
        projectPath,
        stagedManager,
        stagedSoFar,
        noopOnFileStaged,
        options,
    );
    if (failed(githubActionsResult)) {
        stream.markdown(`**Error:** ${githubActionsResult.error}`);
        reportKickstartTelemetry("start.error", { error: "github_actions_failed" });
        return { metadata: { command: "start", projectPath, error: githubActionsResult.error } };
    }

    stream.markdown("\n✅ **Files generated** — review in the panel, then click **Save to project**:\n\n");

    // Build file tree for native chat rendering
    const fileTree: vscode.ChatResponseFileTree[] = [];
    const k8sChildren: vscode.ChatResponseFileTree[] = [];
    for (const sf of stagedSoFar) {
        if (sf.filename.startsWith("k8s/")) {
            k8sChildren.push({ name: sf.filename.replace("k8s/", "") });
        } else {
            fileTree.push({ name: sf.filename });
        }
    }
    if (k8sChildren.length > 0) {
        fileTree.push({ name: "k8s", children: k8sChildren });
    }
    // Use the staging root as the filetree base so clicking a file opens the staged copy
    stream.filetree(fileTree, stagedManager.stagingRoot);
    for (const sf of stagedSoFar) {
        stream.reference(vscode.Uri.parse(sf.stagedPath));
    }

    stream.button({ command: "aks.kickstart.acceptAll", title: "Save to project" });
    if (options?.clusterKey) {
        const { subscriptionId, resourceGroup, clusterName } = options.clusterKey;
        const portalUrl = `https://portal.azure.com/#@/resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}/overview`;
        stream.anchor(vscode.Uri.parse(portalUrl), "Open cluster in Azure Portal");
    }
    if (options?.acrKey) {
        const { subscriptionId, resourceGroup, acrName } = options.acrKey;
        const acrUrl = `https://portal.azure.com/#@/resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerRegistry/registries/${acrName}/overview`;
        stream.anchor(vscode.Uri.parse(acrUrl), "Open ACR in Azure Portal");
    }
    reportKickstartTelemetry("start.completed", { artifactCount: "3" });
    return { metadata: { command: "start", artifactCount: 3, projectPath } };
}

export async function handleSample(
    _request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
): Promise<KickstartResult> {
    stream.markdown(
        "To use the sample, click 'Use a sample' below. After the folder opens, run `@kickstart /start` to begin containerization.",
    );
    stream.button({ command: "aks.kickstart.useSample", title: "Use a sample" });
    return { metadata: { command: "sample" } };
}

function renderPreflightChecks(stream: vscode.ChatResponseStream, options?: Partial<KickstartOptions>): void {
    if (!options) return;

    const lines: string[] = ["### Pre-flight Checks\n"];

    if (options.isAutomatic !== undefined) {
        const skuLabel = options.isAutomatic ? "AKS Automatic" : "AKS Standard";
        const icon = options.isAutomatic ? "⚠️" : "✅";
        lines.push(`${icon} **Cluster SKU:** ${skuLabel}`);
        if (options.isAutomatic) {
            lines.push(
                "  > AKS Automatic manages node pools, scaling, and upgrades. Some Kickstart features may behave differently.",
            );
        }
    }

    if (options.canGetKubeconfig !== undefined) {
        const icon = options.canGetKubeconfig ? "✅" : "❌";
        lines.push(`${icon} **Kubeconfig access:** ${options.canGetKubeconfig ? "Available" : "Denied"}`);
        if (!options.canGetKubeconfig) {
            lines.push(
                "  > You do not have permission to get kubeconfig credentials for this cluster. Ensure you have the **Azure Kubernetes Service Cluster User Role**.",
            );
        }
    }

    if (options.hasAcrPull !== undefined) {
        const icon = options.hasAcrPull ? "✅" : "⚠️";
        lines.push(`${icon} **ACR Pull permission:** ${options.hasAcrPull ? "Configured" : "Not configured"}`);
        if (!options.hasAcrPull) {
            lines.push("  > The cluster does not have AcrPull on this registry. You can attach it below.");
        }
    }

    stream.markdown(lines.join("\n"));
}

function isCancelled(token: vscode.CancellationToken, stream: vscode.ChatResponseStream): boolean {
    if (!token.isCancellationRequested) {
        return false;
    }

    stream.markdown("Cancelled.");
    return true;
}
