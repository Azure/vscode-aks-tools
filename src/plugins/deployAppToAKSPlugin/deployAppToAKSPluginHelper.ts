import * as vscode from "vscode";
import * as path from "path";
import { RestError } from "@azure/storage-blob";
import { failed, getErrorMessage } from "../../commands/utils/errorable";
import { ResourceManagementClient } from "@azure/arm-resources";
import { AgentRequest } from "copilot-for-azure-vscode-api";
import { AutomaticAKSClusterSpec, AutomaticClusterDeploymentBuilder } from "../../panels/utilities/AutomaticClusterSpecCreationBuilder";
import { ClusterResult } from "../common/pluginHelpers";
import { exec } from "../../commands/utils/shell";

export  type InvalidTemplateDeploymentRestError = RestError & {
    details: {
        error?: {
            code: "InvalidTemplateDeployment";
            message?: string;
            details?: {
                code?: string;
                message?: string;
            }[];
        };
    };
};

export function getInvalidTemplateErrorMessage(ex: InvalidTemplateDeploymentRestError): string {
    const innerDetails = ex.details.error?.details || [];
    if (innerDetails.length > 0) {
        const details = innerDetails.map((d) => `${d.code}: ${d.message}`).join("\n");
        return `Invalid template:\n${details}`;
    }

    const innerError = ex.details.error?.message || "";
    if (innerError) {
        return `Invalid template:\n${innerError}`;
    }

    return `Invalid template: ${getErrorMessage(ex)}`;
}

export function isInvalidTemplateDeploymentError(ex: unknown): ex is InvalidTemplateDeploymentRestError {
    return isRestError(ex) && ex.code === "InvalidTemplateDeployment";
}

export  function isRestError(ex: unknown): ex is RestError {
    return typeof ex === "object" && ex !== null && ex.constructor.name === "RestError";
}

export async function getManifestFile(): Promise<string | undefined> {
    const items: vscode.QuickPickItem[] = [];
    await vscode.workspace.findFiles(`**/**.yaml`, "**/node_modules/**").then((result) => {
        result.forEach((fileUri) => {
            const fileName = path.basename(fileUri.fsPath);
            items.push({ label: fileName, description: fileUri.fsPath });
        });
    });

    const fileSelected = await vscode.window.showQuickPick(items.sort(), {
        title: "Select YAML",
        placeHolder: "Select manifest to deploy ...",
    });

    if (!fileSelected) {
        vscode.window.showErrorMessage("Error selecting file");
        return "";
    }

    return fileSelected.description;
}

export async function getNewAKSClusterName(): Promise<string> {
    const resourceName = await vscode.window.showInputBox({
        placeHolder: "Enter a name for the new AKS Cluster",
        prompt: "Enter a name for the new AKS Cluster",
        validateInput: (value) => {
            if (!value) {
                return "Name is required.";
            }
            return null;
        },
    });

    if (!resourceName) {
        return "";
    }

    return resourceName;
}

export async function deployNewAKSCluster(
    agentRequest: AgentRequest,
    resourceManagementClient: ResourceManagementClient,
    clusterSpec: AutomaticAKSClusterSpec,
): Promise<ClusterResult> {
    // Create a unique deployment name.
    const deploymentName = `${clusterSpec.name}-${Math.random().toString(36).substring(5)}`;
    const deploymentSpec = new AutomaticClusterDeploymentBuilder()
        .buildCommonParameters(clusterSpec)
        .buildTemplate("automatic")
        .getDeployment();

    try {
        const poller = await resourceManagementClient.deployments.beginCreateOrUpdate(
            clusterSpec.resourceGroupName,
            deploymentName,
            deploymentSpec,
        );

        agentRequest.responseStream.progress("Deploying your new AKS cluster. This might take a few minutes ...");

        poller.onProgress(async (state) => {
            if (state.status === "canceled") {
                vscode.window.showWarningMessage(`Creating AKS cluster ${clusterSpec.name} was cancelled.`);
                return { status: "cancelled", message: "Creating AKS cluster was cancelled." };
            } else if (state.status === "failed") {
                const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                console.log("state.error: ", state.error);
                vscode.window.showErrorMessage(`Error creating AKS cluster ${clusterSpec.name} (deploymentName: ${deploymentName}): ${errorMessage}`);
                const deploymentResult = await exec(
                    `az deployment operation group list -g ${clusterSpec.resourceGroupName} --name ${deploymentName}`,
                );

                if (failed(deploymentResult)) {
                    vscode.window.showErrorMessage(deploymentResult.error);
                    return;
                }

                return {
                    status: "error",
                    message: `Error creating AKS cluster ${deploymentName}: ${errorMessage}`,
                };
            } else if (state.status === "succeeded") {
                vscode.window.showInformationMessage(`Successfully created AKS cluster ${clusterSpec.name}.`);
                agentRequest.responseStream.progress("Successfully deployed your new AKS cluster.");
                return state;
            }
            return state;
        });

        const res = await poller.pollUntilDone();
        const resourceId = res.properties?.outputResources?.[0]?.id;

        if (!resourceId) {
            return {
                status: "error",
                message: `Failed to get resource id for AKS cluster ${clusterSpec.name}.`,
                clusterName: "",
                clusterId: "",
            };
        }

        return { status: "success", clusterName: clusterSpec.name, clusterId: resourceId };

        
    } catch (ex) {
        const errorMessage = isInvalidTemplateDeploymentError(ex)
            ? getInvalidTemplateErrorMessage(ex)
            : getErrorMessage(ex);
        vscode.window.showErrorMessage(`Error creating AKS cluster ${clusterSpec.name}: ${errorMessage}`);
        return {
            status: "error",
            message: `Error creating AKS cluster ${clusterSpec.name}: ${errorMessage}`,
            clusterName: "",
            clusterId: "",
        };
    }
}