import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as tmpfile from "../utils/tempfile";
import * as k8s from "vscode-kubernetes-tools-api";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getAksClusterTreeNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";
import { KaitoTestPanel, KaitoTestPanelDataProvider } from "../../panels/KaitoTestPanel";
import { ClusterInfo, isClusterInfo } from "../../panels/utilities/KaitoHelpers";

export default async function aksKaitoTest(
    _context: IActionContext,
    { target, modelName, namespace }: { target: unknown; modelName: string; namespace: string },
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return;
    }

    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
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

    let kconfigyaml: string;
    if (isClusterInfo(target)) {
        kconfigyaml = (target as ClusterInfo).yaml;
    } else {
        const clusterInfo = await getKubernetesClusterInfo(
            sessionProvider.result,
            target,
            cloudExplorer,
            clusterExplorer,
        );
        if (failed(clusterInfo)) {
            vscode.window.showErrorMessage(clusterInfo.error);
            return;
        }
        kconfigyaml = clusterInfo.result.kubeconfigYaml;
    }

    const kubeConfigFile = await tmpfile.createTempFile(kconfigyaml, "yaml");

    let src: {
        name: string;
        subscriptionId: string;
        resourceGroupName: string;
    };

    if (isClusterInfo(target)) {
        src = target;
    } else {
        const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
        if (failed(clusterNode)) {
            vscode.window.showErrorMessage(clusterNode.error);
            return;
        }
        src = clusterNode.result;
    }

    const { name: clusterName, subscriptionId, resourceGroupName } = src;

    const panel = new KaitoTestPanel(extension.result.extensionUri);
    const dataProvider = new KaitoTestPanelDataProvider(
        clusterName,
        subscriptionId,
        resourceGroupName,
        kubectl,
        kubeConfigFile.filePath,
        sessionProvider.result,
        modelName,
        namespace,
    );
    panel.show(dataProvider, kubeConfigFile);
}
