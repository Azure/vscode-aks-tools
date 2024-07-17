import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { deleteCluster, getAksClusterTreeNode } from "../utils/clusters";
import { failed, succeeded } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { ModelEntry } from "@huggingface/hub";
import axios from "axios";

const HUGGINGFACE_API_URL = "https://huggingface.co/api/models";

const refreshIntervals = [1, 2, 5, 10, 30, 60, 120];

export default async function aksKaito(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

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

    const clusterName = clusterNode.result.name;
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

    const answer = await vscode.window.showInformationMessage(
        `Do you want to delete cluster ${clusterName}?`,
        "Yes",
        "No",
    );

    if (answer === "Yes") {
        const result = await longRunning(`Deleting cluster ${clusterName}.`, async () => {
            return await deleteCluster(
                sessionProvider.result,
                clusterNode.result.subscriptionId,
                clusterNode.result.resourceGroupName,
                clusterName,
            );
        });

        if (failed(result)) {
            vscode.window.showErrorMessage(result.error);
        }

        if (succeeded(result)) {
            vscode.window.showInformationMessage(result.result);

            // Periodically refresh the subscription treeview, because the list-clusters API
            // call still includes the cluster for a while after it's been deleted.
            refreshIntervals.forEach((interval) => {
                setTimeout(() => {
                    vscode.commands.executeCommand("aks.refreshSubscription", clusterNode.result.subscriptionTreeNode);
                }, interval * 1000);
            });
        }
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
}
