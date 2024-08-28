import { ILocalPluginHandler, LocalPluginArgs, LocalPluginEntry, LocalPluginManifest } from "copilot-for-azure-vscode-api";
import * as vscode from "vscode";
import { failed } from "../../commands/utils/errorable";
import { getReadySessionProvider } from "../../auth/azureAuth";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAssetContext } from "../../assets";
import { CurrentClusterContext, DefinedManagedCluster, getKubeconfigYaml } from "../../commands/utils/clusters";
import { parseResource } from "../../azure-api-utils";
import { getAksClient } from "../../commands/utils/arm";
import { getExistingClusterSelection, getSubscriptionSelection } from "../common/pluginHelpers";

const setClusterContextFunctionName = "setClusterContext";
const showClusterContextFunctionName = "showClusterContext";
const removeClusterContextFunctionName = "removeClusterContext";
type Parameters = {
    commandGenerationIntent: string;
};

const setClusterContextPluginManifest: LocalPluginManifest = {
    name: "setClusterContextPlugin",
    version: "1.0.0",
    functions: [
        {
            name: setClusterContextFunctionName,
            description: "Set current AKS cluster context in VSCode",
            parameters: [],
            returnParameter: {
                description: "Return message.",
                type: "string",
            },
            willHandleUserResponse: false,
        },
        {
            name: showClusterContextFunctionName,
            description: "Show current AKS cluster context in VSCode",
            parameters: [],
            returnParameter: {
                description: "Return message.",
                type: "string",
            },
            willHandleUserResponse: false,
        },
        {
            name: removeClusterContextFunctionName,
            description: "Remove current AKS cluster context in VSCode",
            parameters: [],
            returnParameter: {
                description: "Return message.",
                type: "string",
            },
            willHandleUserResponse: false,
        },
    ],
    applicableTopicScopes: []
};

const setClusterContextPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs<typeof setClusterContextFunctionName, Parameters>) => {
        const pluginRequest = args.localPluginRequest;

        if (pluginRequest.functionName === setClusterContextFunctionName) {
            const sessionProvider = await getReadySessionProvider();
            const kubectl = await k8s.extension.kubectl.v1;
        
            if (failed(sessionProvider)) {
                vscode.window.showErrorMessage(sessionProvider.error);
                return {status: "error", message: sessionProvider.error};
            }
        
            if (!kubectl.available) {
                vscode.window.showWarningMessage(`Kubectl is unavailable.`);
                return {status: "error", message: "Kubectl is unavailable."};
            }
        
            const selectedSubscription = await getSubscriptionSelection(sessionProvider.result);
        
            if (selectedSubscription.status === "cancelled") {
                return {status: "cancelled"};
            }
        
            if (selectedSubscription.status === "error") {
                return { status: "error", message: selectedSubscription.message};
            }
        
            const selectedClusterItem = await getExistingClusterSelection(
                sessionProvider.result,
                selectedSubscription.subscriptionId,
            );
        
            const selectedCluster = selectedClusterItem.clusterName;
            const selectedClusterId = selectedClusterItem.clusterId;
        
            if (!selectedCluster || !selectedClusterId) {
                return {status: "error", message: "No cluster selected."};
            }
        
            let managedCluster = undefined;
            const client = getAksClient(sessionProvider.result, selectedSubscription.subscriptionId);
        
            try {
                managedCluster = (await client.managedClusters.get(
                    parseResource(selectedClusterId).resourceGroupName!,
                    selectedCluster,
                )) as DefinedManagedCluster;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                vscode.window.showErrorMessage(e.message);
            }
        
            if (!managedCluster) {
                vscode.window.showErrorMessage(`Failed to get managed cluster: ${selectedCluster}`);
                return {status: "error", message: `Failed to get managed cluster: ${selectedCluster}`};
            }
        
            // Get KubeConfig file
            const kubeconfigYaml = await getKubeconfigYaml(
                sessionProvider.result,
                selectedSubscription.subscriptionId,
                parseResource(selectedClusterId).resourceGroupName!,
                managedCluster!,
            );
            if (failed(kubeconfigYaml)) {
                return {status: "error", message: kubeconfigYaml.error};
            }
        
            const kubeConfigYAMLResult = kubeconfigYaml.result;

            const clusterContext: CurrentClusterContext = {
                clusterName: selectedCluster,
                subscriptionId: selectedSubscription.subscriptionId,
                clusterId: selectedClusterId,
                resourceGroup: parseResource(selectedClusterId).resourceGroupName!,
                kubeConfig: kubeConfigYAMLResult,
                subscriptionName: selectedSubscription.subscriptionName,
            }

            const asset = getAssetContext();
            await asset.globalState.update("currentCluster", JSON.stringify(clusterContext));
            return {status: "success", message: `Successfully set current cluster. Current AKS cluster: ${selectedCluster}`};

        } else if (pluginRequest.functionName === showClusterContextFunctionName) { 

            const asset = getAssetContext();
            const currentCluster = await asset.globalState.get("currentCluster") as string;

            if(!currentCluster) {
                vscode.window.showErrorMessage("AKS cluster is not set. Please set the AKS cluster first.");
                return {status: "cancelled", message: "AKS cluster is not set. Please set the AKS cluster first."};
            }

            const parsedCurrentCluster = JSON.parse(currentCluster) as CurrentClusterContext;

            return {status: "success", message: `Current cluster : ${parsedCurrentCluster.clusterName}, resource group: ${parsedCurrentCluster.resourceGroup}, and subscription: ${parsedCurrentCluster.subscriptionName}`};

        } else if (pluginRequest.functionName === removeClusterContextFunctionName) { 

            const asset = getAssetContext();
            await asset.globalState.update("currentCluster", undefined);

            return {status: "success", message: `AKS cluster context has been removed.`};
        }

        return {
            status: "error",
            message: "Unrecognized command.",
        };
    },
};

export const setClusterContextPlugin: LocalPluginEntry = {
    manifest: setClusterContextPluginManifest,
    handler: setClusterContextPluginHandler,
};