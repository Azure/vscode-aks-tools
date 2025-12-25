import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";
import { KaitoTestPanel, KaitoTestPanelDataProvider } from "../../panels/KaitoTestPanel";
import { getClusterDetails } from "../../panels/utilities/KaitoHelpers";

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

    // Target can be different depending on how the command is invoked.
    // This logic accounts for the different cases of invocation.
    const result = await getClusterDetails(target, sessionProvider.result, cloudExplorer, clusterExplorer);
    if (!result) return;
    const { clusterName, subscriptionId, resourceGroupName, kubeConfigFile } = result;

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
