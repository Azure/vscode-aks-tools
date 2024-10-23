import path from "path";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getEnvironment, getReadySessionProvider } from "../../auth/azureAuth";
import { selectClusterOptions } from "../../plugins/shared/clusterOptions/selectClusterOptions";
import { ClusterPreference } from "../../plugins/shared/types";
import { getPortalResourceUrl } from "../utils/env";
import { Errorable, failed } from "../utils/errorable";
import { checkExtension, handleExtensionDoesNotExist } from "../utils/ghCopilotHandlers";
import { longRunning } from "../utils/host";
import { invokeKubectlCommand } from "../utils/kubectl";
import { createTempFile } from "../utils/tempfile";
import { logGitHubCopilotPluginEvent } from "../../plugins/shared/telemetry/logger";

const GITHUBCOPILOT_FOR_AZURE_VSCODE_ID = "ms-azuretools.vscode-azure-github-copilot";
const YAML_GLOB_PATTERN = "**/*.yaml";
const EXCLUDE_PATTERN = "**/node_modules/**";
const AUTOMATIC_WORKLOADS_PATH = "/aksAutomaticWorkloads";
const BASE_WORKLOADS_PATH = "/workloads";

export async function aksDeployManifest() {
    // Check if GitHub Copilot for Azure extension is installed
    const checkGitHubCopilotExtension = checkExtension(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);

    if (!checkGitHubCopilotExtension) {
        handleExtensionDoesNotExist(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);
        return;
    }

    // Select manifest
    const manifest = await getManifestFile();

    if (manifest === undefined) {
        logGitHubCopilotPluginEvent({ commandId: "aks.aksDeployManifest", manifestSelected: "false" });
        return;
    }

    logGitHubCopilotPluginEvent({ commandId: "aks.aksDeployManifest", manifestSelected: "true" });

    // Select cluster
    const sessionProvider = await getReadySessionProvider();

    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const cluster = await selectClusterOptions(sessionProvider.result, undefined, "aks.aksDeployManifest");

    if (failed(cluster)) {
        logGitHubCopilotPluginEvent({ commandId: "aks.aksDeployManifest", clusterSelected: "false" });
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    // Return value is boolean if user selects new cluster option, which should stop flow and guide user to create a new cluster first.
    if (cluster.result === true) {
        vscode.window.showInformationMessage("Please create AKS cluster before deploying the manifest.");
        return;
    }

    const clusterPreference = cluster.result as ClusterPreference;

    // Confirm deployment
    const confirmed = await confirmDeployment(clusterPreference.clusterName);

    if (!confirmed) {
        vscode.window.showWarningMessage("Manifest deployment cancelled.");
        logGitHubCopilotPluginEvent({ commandId: "aks.aksDeployManifest", manifestDeploymentCancelled: "true" });
        return;
    }

    const deploymentResult = await deployApplicationToCluster({
        cluster: clusterPreference,
        manifestPath: manifest,
    });

    if (failed(deploymentResult)) {
        vscode.window.showErrorMessage(deploymentResult.error);
        logGitHubCopilotPluginEvent({ commandId: "aks.aksDeployManifest", manifestDeploymentSuccess: "false" });
        return;
    }

    logGitHubCopilotPluginEvent({ commandId: "aks.aksDeployManifest", manifestDeploymentSuccess: "true" });

    vscode.window
        .showInformationMessage(
            `Your application has been successfully deployed to the ${clusterPreference.clusterName} AKS cluster.`,
            "View resource in the Azure portal",
        )
        .then((res) => {
            if (res) {
                logGitHubCopilotPluginEvent({
                    commandId: "aks.aksDeployManifest",
                    manifestDeploymentLinkClicked: "true",
                });
                vscode.env.openExternal(vscode.Uri.parse(deploymentResult.result.url));
            }
        });
}

type ManifestQuickPickItem = vscode.QuickPickItem & { filePath: string };

async function getManifestFile(): Promise<string | undefined> {
    try {
        // Find all YAML files in the workspace, excluding node_modules
        const files = await vscode.workspace.findFiles(YAML_GLOB_PATTERN, EXCLUDE_PATTERN);

        // If no files are found, show a warning and exit
        if (files.length === 0) {
            vscode.window.showWarningMessage("No manifest files found in the workspace.");
            return undefined;
        }

        // Map the found files to QuickPick items
        const items: ManifestQuickPickItem[] = files.map((fileUri) => ({
            label: path.basename(fileUri.fsPath),
            description: fileUri.fsPath,
            filePath: fileUri.fsPath,
        }));

        // Show the QuickPick to the user to select a file
        const fileSelected = await vscode.window.showQuickPick(
            items.sort((a, b) => a.label.localeCompare(b.label)),
            {
                title: "Select YAML",
                placeHolder: "Select manifest to deploy",
            },
        );

        // If no file was selected, show a warning and exit
        if (!fileSelected) {
            vscode.window.showWarningMessage("Manifest file not selected");
            return undefined;
        }

        return fileSelected.filePath;
    } catch {
        vscode.window.showErrorMessage(`Error finding manifest files`);
        return undefined;
    }
}

const enum ConfirmDeployment {
    Yes = "Yes",
    No = "No",
}

async function confirmDeployment(clusterName: string): Promise<boolean> {
    const selection = await vscode.window.showQuickPick([ConfirmDeployment.Yes, ConfirmDeployment.No], {
        title: `Do you want to deploy to this cluster: ${clusterName}?`,
        placeHolder: "Select option",
    });

    return selection === ConfirmDeployment.Yes;
}

type DeployApplicationToClusterOptions = {
    cluster: ClusterPreference;
    manifestPath: string;
};
type DeployApplicationToClusterResult = { url: string };

async function deployApplicationToCluster(
    params: DeployApplicationToClusterOptions,
): Promise<Errorable<DeployApplicationToClusterResult>> {
    const { cluster, manifestPath } = params;

    // Ensure kubectl is available
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showWarningMessage("Kubectl is unavailable.");
        return { succeeded: false, error: "Kubectl is unavailable." };
    }

    // Create a temporary kubeconfig file
    const kubeConfigFile = await createTempFile(cluster.kubeConfigYAML, "yaml");

    // Execute the deployment command
    const result = await longRunning(
        `Deploying application to cluster: ${cluster.clusterName} in progress...`,
        async () => invokeKubectlCommand(kubectl, kubeConfigFile.filePath, `apply -f "${manifestPath}"`),
    );

    // Check for errors during the kubectl command execution
    if (failed(result)) {
        return { succeeded: false, error: result.error };
    }

    // Generate and return the resource URL
    const clusterIdworkloadsPath =
        cluster.sku?.name === "Automatic"
            ? `${cluster.clusterId + AUTOMATIC_WORKLOADS_PATH}`
            : `${cluster.clusterId + BASE_WORKLOADS_PATH}`;
    const resourceUrl = getPortalResourceUrl(getEnvironment(), clusterIdworkloadsPath);
    return { succeeded: true, result: { url: resourceUrl } };
}
