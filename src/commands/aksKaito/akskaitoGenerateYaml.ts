import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import kaitoSupporterModel from "../../../resources/kaitollmconfig/kaitollmconfig.json";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { filterPodName, getAksClusterTreeNode } from "../utils/clusters";
import { getWorkflowYaml, substituteClusterInWorkflowYaml } from "../utils/configureWorkflowHelper";
import { failed } from "../utils/errorable";
import { getExtension, longRunning } from "../utils/host";

export default async function aksKaitoGenerateYaml(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
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
        return undefined;
    }

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }

    const clusterName = clusterNode.result.name;
    const subscriptionId = clusterNode.result.subscriptionId;
    const resourceGroupName = clusterNode.result.resourceGroupName;

    const filterKaitoPodNames = await longRunning(`Checking if KAITO is installed.`, () => {
        return filterPodName(sessionProvider.result, kubectl, subscriptionId, resourceGroupName, clusterName, "kaito-");
    });

    if (failed(filterKaitoPodNames)) {
        vscode.window.showErrorMessage(filterKaitoPodNames.error);
        return;
    }

    // Check if Kaito pods  exist
    if (filterKaitoPodNames.result.length === 0) {
        vscode.window.showWarningMessage(
            `Please install Kaito for cluster ${clusterName}. \n \n Kaito Workspace generation is only enabled when kaito is installed. Skipping generation.`,
        );
        return;
    }

    // Pick a standard supported models for KAITO from config file within
    const kaitoSelectedModels = await vscode.window.showQuickPick(listKaitoSUpportedModel(), {
        canPickMany: true,
        placeHolder: "Please select current supported KAITO model.",
        title: "KAITO Supported Model.",
    });

    if (!kaitoSelectedModels) {
        vscode.window.showErrorMessage("No LLM Model Selected.");
        return;
    }

    const selectedNodes = kaitoSelectedModels.map((item) => item).join(",");

    // Configure the starter workflow data.
    const starterWorkflowYaml = getWorkflowYaml("kaitoworkspace");
    if (failed(starterWorkflowYaml)) {
        vscode.window.showErrorMessage(starterWorkflowYaml.error);
        return;
    }

    const substitutedYaml = substituteClusterInWorkflowYaml(
        starterWorkflowYaml.result,
        "Standard_NC12s_v3",
        selectedNodes,
    );

    // Display it to the end-user in their vscode editor.
    const doc = await vscode.workspace.openTextDocument({
        content: substitutedYaml,
        language: "yaml",
    });

    vscode.window.showTextDocument(doc);
}

function listKaitoSUpportedModel() {
    const modelList = [
        kaitoSupporterModel.modelsupported.falcon,
        kaitoSupporterModel.modelsupported.llama2,
        kaitoSupporterModel.modelsupported.llama2chat,
        kaitoSupporterModel.modelsupported.mistral,
        kaitoSupporterModel.modelsupported["phi-2"],
        kaitoSupporterModel.modelsupported["phi-3"],
    ];
    return modelList.flat();
}
