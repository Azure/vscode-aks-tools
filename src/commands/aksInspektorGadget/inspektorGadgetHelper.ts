import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
import * as tmpfile from "../utils/tempfile";
import { getKubectlGadgetBinaryPath } from "../utils/helper/kubectlGadgetDownload";
import path from "path";
import { InspektorGadgetDataProvider, InspektorGadgetPanel } from "../../panels/InspektorGadgetPanel";
import { KubectlClusterOperations } from "./clusterOperations";
import { TraceWatcher } from "./traceWatcher";
import { ensureDirectoryInPath } from "../utils/env";
import { getReadySessionProvider } from "../../auth/azureAuth";

export interface TraceConfig {
    title: string; // Progress notification title
    resource: string; // Gadget resource type (e.g., "dns", "tcp")
}

/**
 * Common helper function to open the Inspektor Gadget panel with a specific trace type pre-selected
 *
 * @param context The action context
 * @param target The Kubernetes cluster target
 * @param config Configuration for the trace (title and resource type)
 */
export async function openInspektorGadgetTrace(
    _context: IActionContext,
    target: unknown,
    config: TraceConfig,
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return;
    }

    const clusterInfo = await getKubernetesClusterInfo(sessionProvider.result, target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return;
    }

    const kubectlGadgetPath = await getKubectlGadgetBinaryPath();
    if (failed(kubectlGadgetPath)) {
        vscode.window.showWarningMessage(`kubectl gadget path was not found ${kubectlGadgetPath.error}`);
        return;
    }

    ensureDirectoryInPath(path.dirname(kubectlGadgetPath.result));

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const clusterOperations = new KubectlClusterOperations(kubectl, clusterInfo.result, kubeConfigFile.filePath);
    const traceWatcher = new TraceWatcher(clusterOperations, clusterInfo.result.name);
    const dataProvider = new InspektorGadgetDataProvider(clusterOperations, clusterInfo.result.name, traceWatcher);

    // Check if Inspektor Gadget is installed before showing progress notification
    const isRunning = await clusterOperations.isInspektorGadgetRunning();
    if (failed(isRunning)) {
        vscode.window.showErrorMessage(`Failed to check Inspektor Gadget status: ${isRunning.error}`);
        return;
    }

    if (!isRunning.result) {
        const items = [
            {
                label: "$(rocket) Deploy Inspektor Gadget",
                description: "Install debugging tools on this cluster",
                detail: `Required for ${config.title}`,
                action: "deploy",
            },
            {
                label: "$(x) Cancel",
                description: "Skip this operation",
                action: "cancel",
            },
        ];

        const selection = await vscode.window.showQuickPick(items, {
            title: "Inspektor Gadget Setup",
            placeHolder: "Inspektor Gadget is not installed on this cluster",
            canPickMany: false,
            ignoreFocusOut: true,
        });

        if (selection?.action !== "deploy") {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Deploying Inspektor Gadget",
                cancellable: false,
            },
            async () => {
                const deployResult = await clusterOperations.deploy();
                if (failed(deployResult)) {
                    vscode.window.showErrorMessage(`Failed to deploy Inspektor Gadget: ${deployResult.error}`);
                    return;
                }

                // Verify installation was successful
                const verifyRunning = await clusterOperations.isInspektorGadgetRunning();
                if (failed(verifyRunning) || !verifyRunning.result) {
                    vscode.window.showErrorMessage("Inspektor Gadget deployment was unsuccessful.");
                    return;
                }
            },
        );
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: config.title,
            cancellable: false,
        },
        async () => {
            const panel = new InspektorGadgetPanel(extension.result.extensionUri);

            panel.showWithConfig(dataProvider, kubeConfigFile, traceWatcher, {
                initialTab: "trace",
                initialGadget: {
                    category: "trace",
                    resource: config.resource,
                    isStatic: true, // Make gadget selection read-only when directly invoked from menu
                },
            });

            return;
        },
    );
}
