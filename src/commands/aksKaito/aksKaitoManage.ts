import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as tmpfile from "../utils/tempfile";
import * as k8s from "vscode-kubernetes-tools-api";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { KaitoManagePanelDataProvider } from "../../panels/KaitoManagePanel";
import { KaitoManagePanel } from "../../panels/KaitoManagePanel";
import { getAksClusterTreeNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";
import { getConditions, convertAgeToMinutes } from "../../panels/utilities/KaitoHelpers";
import { invokeKubectlCommand } from "../utils/kubectl";
import { getKaitoInstallationStatus } from "../utils/kaitoValidationHelpers";

export default async function aksKaitoManage(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
    const kubectl = await k8s.extension.kubectl.v1;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
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

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const { name: clusterName, armId, subscriptionId, resourceGroupName } = clusterNode.result;

    // Returns an object with the status of the kaito pods
    const kaitoStatus = await getKaitoInstallationStatus(
        sessionProvider,
        kubectl,
        subscriptionId,
        resourceGroupName,
        clusterName,
        clusterInfo,
    );

    // Only proceed if kaito is installed and both the workspace & gpu-provisioner pods are running
    if (!kaitoStatus.kaitoInstalled || !kaitoStatus.kaitoWorkspaceReady || !kaitoStatus.kaitoGPUProvisionerReady) {
        return;
    }

    // The logic below is to acquire the initial deployment data.
    const command = `get workspace -o json`;
    const kubectlresult = await invokeKubectlCommand(kubectl, kubeConfigFile.filePath, command);
    if (failed(kubectlresult)) {
        vscode.window.showErrorMessage(`Error retrieving workspaces: ${kubectlresult.error}`);
        return;
    }
    const models = [];
    const data = JSON.parse(kubectlresult.result.stdout);
    for (const item of data.items) {
        const conditions: Array<{ type: string; status: string }> = item.status?.conditions || [];
        const { resourceReady, inferenceReady, workspaceReady } = getConditions(conditions);
        // The data below is used to indicate the current progress of the active model deployments
        models.push({
            name: item.inference?.preset?.name,
            instance: item.resource?.instanceType,
            resourceReady: resourceReady,
            inferenceReady: inferenceReady,
            workspaceReady: workspaceReady,
            age: convertAgeToMinutes(item.metadata?.creationTimestamp),
        });
    }

    const panel = new KaitoManagePanel(extension.result.extensionUri);
    const dataProvider = new KaitoManagePanelDataProvider(
        clusterName,
        subscriptionId,
        resourceGroupName,
        armId,
        kubectl,
        kubeConfigFile.filePath,
        models,
        target,
    );
    panel.show(dataProvider);
}
