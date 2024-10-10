import * as vscode from "vscode";
import { Errorable, failed } from "../utils/errorable";
import { getEnvironment, getReadySessionProvider } from "../../auth/azureAuth";
import { selectClusterOptions } from "../../plugins/shared/clusterOptions/selectClusterOptions";
import path from "path";
import { ClusterPreference } from "../../plugins/shared/types";
import * as k8s from "vscode-kubernetes-tools-api";
import { longRunning } from "../utils/host";
import { invokeKubectlCommand } from "../utils/kubectl";
import { getPortalResourceUrl } from "../utils/env";
import { createTempFile } from "../utils/tempfile";
import { checkExtension, handleExtensionDoesNotExist } from "../utils/ghCopilotHandlers";

const GITHUBCOPILOT_FOR_AZURE_VSCODE_ID = "ms-azuretools.vscode-azure-github-copilot";

export async function aksDeployManifest() {
    // Check if GitHub Copilot for Azure extension is installed
    const checkGitHubCopilotExtension = checkExtension(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);

    if(!checkGitHubCopilotExtension) {
        handleExtensionDoesNotExist(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);
        return;
    }

    // Select manifest
    const manifest = await getManifestFile();

    if(manifest === undefined) { 
        return;
    }

    // Select cluster
    const sessionProvider = await getReadySessionProvider();

    if(failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const cluster = await selectClusterOptions(sessionProvider.result);

    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    if (cluster.result === false) {
        vscode.window.showWarningMessage("No cluster selected.");
        return;
    }

    const clusterPreference = cluster.result as ClusterPreference;

    // Confirm deployment
    const confirmed = await confirmDeployment(clusterPreference.clusterName);

    if(!confirmed) {
        vscode.window.showWarningMessage("Deployment cancelled.");
        return;
    }

    const deploymentResult = await deployApplicationToCluster({
        cluster: clusterPreference,
        manifestPath: manifest
    });

    if(failed(deploymentResult)) {
        vscode.window.showErrorMessage(deploymentResult.error);
        return;
    }

    vscode.window.showInformationMessage(`Your applicatoin has been successfully deployed to the ${clusterPreference.clusterName} AKS cluster.`, "View resource in the Azure portal").then((res) => {
        if(res) {
            vscode.env.openExternal(vscode.Uri.parse(deploymentResult.result.url));
        }
    });
}

type ManifestQuickPickItem = vscode.QuickPickItem & {filePath: string};

async function getManifestFile(): Promise<string | undefined> {
    const items: ManifestQuickPickItem[] = [];
    await vscode.workspace.findFiles(`**/**.yaml`, "**/node_modules/**").then((result) => {
        result.forEach((fileUri) => {
            const fileName = path.basename(fileUri.fsPath);
            items.push({ label: fileName, description: fileUri.fsPath, filePath: fileUri.fsPath });
        });
    });

    if(items.length === 0) {
        vscode.window.showWarningMessage("No manifest files found in the workspace.");
        return;
    }

    const fileSelected = await vscode.window.showQuickPick(items.sort(), {
        title: "Select YAML",
        placeHolder: "Select manifest to deploy",
    });

    if (!fileSelected) {
        vscode.window.showWarningMessage("Manifest file not selected");
        return;
    }

    return fileSelected.filePath;
}

async function confirmDeployment(clusterName: string): Promise<boolean> {
    const confirmed = await vscode.window.showQuickPick(["Yes", "No"], {
        title: `Do you want to deploy to this cluster: ${clusterName}?`,
        placeHolder: "Select option",
    });

    return confirmed === "Yes";
}

type DeployApplicationToClusterOptions = {
    cluster: ClusterPreference;
    manifestPath: string;
};
type DeployApplicationToClusterResult = { url: string };

async function deployApplicationToCluster(params: DeployApplicationToClusterOptions): Promise<Errorable<DeployApplicationToClusterResult>> {
    const { cluster, manifestPath } = params;

    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return { succeeded: false, error: "Kubectl is unavailable." };
    }

    const kubeConfigFile = await createTempFile(cluster.kubeConfigYAML, "yaml");

    const result = await longRunning(`Deployment of application to cluster: ${cluster.clusterName} in progress`, async () => {
        return await invokeKubectlCommand(kubectl, kubeConfigFile.filePath, `apply -f ${manifestPath}`);
    });

    if (failed(result)) {
        return { succeeded: false, error: result.error };
    }

    const resourceUrl = getPortalResourceUrl(getEnvironment(), cluster.clusterId);
    return { succeeded: true, result: { url : resourceUrl } };
}