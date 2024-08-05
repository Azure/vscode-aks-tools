import { IActionContext } from "@microsoft/vscode-azext-utils";
import { Errorable, failed } from "../utils/errorable";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getExtension, longRunning } from "../utils/host";
// import { CreateClusterDataProvider, CreateClusterPanel } from "../../panels/CreateClusterPanel";
import { getReadySessionProvider } from "../../auth/azureAuth";
import * as path from "path";
// import * as fs from "fs";
import { getAksClusterTreeNode, getKubernetesClusterInfo } from "../utils/clusters";
import * as tmpfile from "../utils/tempfile";
import { invokeKubectlCommand } from "../utils/kubectl";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function aksDeployLocalApp(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
    const kubectl = await k8s.extension.kubectl.v1;
    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return;
    }

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }
    
    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    // Select manifest file
    const items: vscode.QuickPickItem[] = [];
    await vscode.workspace.findFiles("**/*.yaml", "**/node_modules/**").then(result => {
        result.forEach((fileUri) => {
            const fileName = path.basename(fileUri.fsPath);
            items.push({ label: fileName, description: fileUri.fsPath });
        });
    });

    const fileSelected = await vscode.window.showQuickPick(items.sort(), { title: "Select YAML", placeHolder: "Select manifest to deploy ..." })

    if (!fileSelected) {
        vscode.window.showErrorMessage("Error selecting file");
        return;
    }
  
    const clusterInfo = await getKubernetesClusterInfo(sessionProvider.result, target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return;
    }


    const confirmDeployment = await vscode.window.showQuickPick([{label: "Yes"}, {label: "No"}], { title: `Do you want to deploy to this cluster: ${clusterInfo.result.name}?`, placeHolder: "Select option ..." });
    if (confirmDeployment && confirmDeployment.label === "No") {
        vscode.window.showErrorMessage("Deployment operation cancelled");
        return;
    }

    // Get KubeConfig file
    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");

    // Deploy app using kubectl
    const deploymentResult = await longRunning(
        `Deploying application to cluster ${clusterInfo.result.name}.`,
        async () => {
            return await invokeKubectlCommand(
                kubectl,
                kubeConfigFile.filePath,
                `apply -f ${fileSelected.description}`,
            );
        },
    );

    
    if (failed(deploymentResult)) {
        vscode.window.showErrorMessage(`Failed to deploy application to the cluster: ${deploymentResult.error}`);
        return;
    }

    const getPodsResult = await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
        clusterInfo.result.kubeconfigYaml,
        "YAML",
        (kubeConfigFile) =>
            invokeKubectlCommand(kubectl, kubeConfigFile, 'get pods'),
    );

    if (failed(getPodsResult)) {
        vscode.window.showErrorMessage(`Failed to get pods for cluster: ${getPodsResult.error}`);
        return;
    }

    vscode.window.showInformationMessage("Deployment succeeded. Check the cluster for the deployed application.");
    return;
}
