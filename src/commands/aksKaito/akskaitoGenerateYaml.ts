import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { filterPodName, getAksClusterTreeNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { ModelEntry } from "@huggingface/hub";
import axios from "axios";
import { getWorkflowYaml, substituteClusterInWorkflowYaml } from "../utils/configureWorkflowHelper";

const HUGGINGFACE_API_URL = "https://huggingface.co/api/models";

export default async function aksKaitoGenrateYaml(_context: IActionContext, target: unknown): Promise<void> {
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

    const filterKaitoPodNames = await filterPodName(
        sessionProvider.result,
        kubectl,
        subscriptionId,
        resourceGroupName,
        clusterName,
        "kaito-",
    );

    if (failed(filterKaitoPodNames)) {
        vscode.window.showErrorMessage(filterKaitoPodNames.error);
        return;
    }

    // Check if Kaito pods  exist
    if (filterKaitoPodNames.result.length === 0) {
        vscode.window.showInformationMessage(
            `Please install Kaito for this cluster. \n Kaito Workspace generation is only enabled when kaito is installed. Skipping generation.`,
        );
        return;
    }

    // const clusterName = clusterNode.result.name;
    const foo = listModelsWithPrefix("azure");

    // for await (const model of listModels({ search: { query: "" } })) {
    //     // { search: { owner: username }, credentials }
    //     console.log("My model:", model);
    //     foo.push(model.name);
    // }

    // Pick a Node to Capture Traffic From
    const nodeNamesSelected = await vscode.window.showQuickPick(foo, {
        canPickMany: true,
        placeHolder: "Please select all Hugging face model.",
        title: "Select LLM Hugging Face Model",
    });

    if (!nodeNamesSelected) {
        vscode.window.showErrorMessage("No LLM Model Selected.");
        return;
    }

    const selectedNodes = nodeNamesSelected.map((item) => item).join(",");

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

async function listModelsWithPrefix(prefix: string) {
    try {
        const response = await axios.get(HUGGINGFACE_API_URL, {
            params: {
                search: prefix,
            },
        });

        const models = response.data;
        const filteredModels = models.filter((model: ModelEntry) => model.id.startsWith(prefix));

        console.log(`Models starting with "${prefix}":`);
        filteredModels.forEach((model: ModelEntry) => {
            console.log(model.id);
        });

        const filterModelList = [""];
        filteredModels.forEach((model: ModelEntry) => {
            filterModelList.push(model.id);
        });

        return filterModelList;
    } catch (error) {
        console.error("Error fetching models from Hugging Face:", error);
        return [""];
    }
}
