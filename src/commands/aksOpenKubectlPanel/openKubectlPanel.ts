import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { KubectlDataProvider, KubectlPanel } from "../../panels/KubectlPanel";
import { CommandOptions } from "../../plugins/shared/pluginResponses";
import { getExtension } from "../utils/host";
import { getKubectlCustomCommands } from "../utils/config";
import { failed } from "../utils/errorable";
import { createTempFile } from "../utils/tempfile";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { selectClusterOptions } from "../../plugins/shared/clusterOptions/selectClusterOptions";
import { GITHUBCOPILOT_FOR_AZURE_VSCODE_ID } from "../../plugins/shared/constants";
import { checkExtension, handleExtensionDoesNotExist } from "../utils/extensions";

export async function openKubectlPanel(_context: IActionContext, target: unknown) {

    const checkGitHubCopilotExtension = checkExtension(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);

    if(!checkGitHubCopilotExtension) {
        handleExtensionDoesNotExist(GITHUBCOPILOT_FOR_AZURE_VSCODE_ID);
        return;
    }

    const responseCode = (target as CommandOptions).response.code;
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

    if (typeof cluster.result === "boolean") {
        vscode.window.showErrorMessage("No cluster selected.");
        return;
    }

    const generatedCommandsFromChat = [responseCode];

    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }

    const extension = getExtension();

    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const kubeConfigFile = await createTempFile(cluster.result.kubeConfigYAML, "yaml");

    const customCommands = getKubectlCustomCommands();
    const dataProvider = new KubectlDataProvider(
        kubectl,
        kubeConfigFile.filePath,
        cluster.result.clusterName,
        customCommands,
        generatedCommandsFromChat[0]
    );
    const panel = new KubectlPanel(extension.result.extensionUri);

    panel.show(dataProvider, kubeConfigFile);
}