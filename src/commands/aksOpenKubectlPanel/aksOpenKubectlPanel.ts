import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { KubectlDataProvider, KubectlPanel } from "../../panels/KubectlPanel";
import { CommandResponse } from "../../plugins/shared/pluginResponses";
import { getExtension } from "../utils/host";
import { getKubectlCustomCommands } from "../utils/config";
import { failed } from "../utils/errorable";
import { createTempFile } from "../utils/tempfile";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { selectClusterOptions, SelectClusterOptions } from "../../plugins/shared/clusterOptions/selectClusterOptions";
import { checkExtension, handleExtensionDoesNotExist } from "../utils/ghCopilotHandlers";
import { ClusterPreference } from "../../plugins/shared/types";
import { logGitHubCopilotPluginEvent } from "../../plugins/shared/telemetry/logger";

const GITHUBCOPILOT_FOR_AZURE_VSCODE_ID = "ms-azuretools.vscode-azure-github-copilot";

export async function aksOpenKubectlPanel(_context: IActionContext, target: unknown) {
    const checkGitHubCopilotExtension = checkExtension(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);

    if (!checkGitHubCopilotExtension) {
        handleExtensionDoesNotExist(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }

    const responseCode = (target as CommandResponse).code;
    const sessionProvider = await getReadySessionProvider();

    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const cluster = await selectClusterOptions(
        sessionProvider.result,
        [SelectClusterOptions.NewCluster],
        "aks.aksOpenKubectlPanel",
    );

    if (failed(cluster)) {
        logGitHubCopilotPluginEvent({ commandId: "aks.aksOpenKubectlPanel", clusterSelected: "false" });
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    // This should never happen, since the new cluster option is excluded. Leaving here just in case.
    if (cluster.result === true) {
        vscode.window.showInformationMessage("No cluster selected. Please select a valid cluster.");
        return;
    }

    const extension = getExtension();

    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const clusterPreference = cluster.result as ClusterPreference;

    const kubeConfigFile = await createTempFile(clusterPreference.kubeConfigYAML, "yaml");

    const customCommands = getKubectlCustomCommands();
    const dataProvider = new KubectlDataProvider(
        kubectl,
        kubeConfigFile.filePath,
        clusterPreference.clusterName,
        customCommands,
        responseCode,
    );
    const panel = new KubectlPanel(extension.result.extensionUri);

    panel.show(dataProvider, kubeConfigFile);
}
