import { ILocalPluginHandler, LocalPluginArgs, LocalPluginEntry, LocalPluginManifest } from "copilot-for-azure-vscode-api";
import * as vscode from "vscode";
import { failed, Succeeded } from "../../commands/utils/errorable";
import { getReadySessionProvider } from "../../auth/azureAuth";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAssetContext } from "../../assets";
import { CurrentClusterContext, DefinedManagedCluster, getKubeconfigYaml } from "../../commands/utils/clusters";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { parseResource } from "../../azure-api-utils";
import { getAksClient } from "../../commands/utils/arm";
import { getResources, DefinedResourceWithGroup } from "../../commands/utils/azureResources";
import { SubscriptionFilter } from "../../commands/utils/config";
import { getSubscriptions, SelectionType } from "../../commands/utils/subscriptions";

const setClusterContextFunctionName = "setClusterContext";
const showClusterContextFunctionName = "showClusterContext";
const removeClusterContextFunctionName = "removeClusterContext";

type SubscriptionQuickPickItem = vscode.QuickPickItem & { subscription: SubscriptionFilter };

type SuccessResult = { status: "success"; message?: string };
type ErrorResult = { status: "error"; message: string };
type CancelledResult = { status: "cancelled" };

type ReturnResult = SuccessResult | ErrorResult | CancelledResult;
type SubscriptionSelectionResult = { subscriptionName: string; subscriptionId: string } & ReturnResult;

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
};

async function getSubscriptionResult(sessionProvider: ReadyAzureSessionProvider): Promise<SubscriptionSelectionResult> {
    const allSubscriptions = await getSubscriptions(sessionProvider, SelectionType.All);

    if (failed(allSubscriptions)) {
        vscode.window.showErrorMessage(allSubscriptions.error);
        return { status: "error", message: allSubscriptions.error, subscriptionId: "", subscriptionName: "" };
    }

    if (allSubscriptions.result.length === 0) {
        const noSubscriptionsFound = "No subscriptions were found. Set up your account if you have yet to do so.";
        const setupAccount = "Set up Account";
        const response = await vscode.window.showInformationMessage(noSubscriptionsFound, setupAccount);
        if (response === setupAccount) {
            vscode.env.openExternal(vscode.Uri.parse("https://azure.microsoft.com/"));
        }

        return { status: "error", message: noSubscriptionsFound, subscriptionId: "", subscriptionName: "" };
    }
    const authSession = await sessionProvider.getAuthSession();

    if (failed(authSession)) {
        vscode.window.showErrorMessage(authSession.error);
        return { status: "error", message: authSession.error, subscriptionId: "", subscriptionName: "" };
    }

    const filteredSubscriptions: SubscriptionFilter[] = await allSubscriptions.result
        .filter((sub) => sub.tenantId === authSession.result.tenantId)
        .map((sub) => ({
            tenantId: sub.tenantId || "",
            subscriptionId: sub.subscriptionId || "",
            label: sub.displayName || "",
        }));

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.result.map((sub) => {
        return {
            label: sub.displayName || "",
            description: sub.subscriptionId,
            picked: filteredSubscriptions.some((filteredSub) => filteredSub.subscriptionId === sub.subscriptionId), // Set to true if the subscription is in filteredSubscriptions,
            subscription: {
                subscriptionId: sub.subscriptionId || "",
                tenantId: sub.tenantId || "",
            },
        };
    });

    const selectedSubscription = await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: false,
        placeHolder: "Select Subscription",
    });

    if (!selectedSubscription) {
        return { status: "cancelled", subscriptionId: "", subscriptionName: "" };
    }

    return {
        status: "success",
        subscriptionId: selectedSubscription.subscription.subscriptionId,
        subscriptionName: selectedSubscription.label,
    };
}

type ClusterResult = { clusterName: string; clusterId: string } & ReturnResult;
async function getExistingCluster(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<ClusterResult> {
    const clusterResources = await getResources(
        sessionProvider,
        subscriptionId,
        "Microsoft.ContainerService/managedClusters",
    );

    if (failed(clusterResources)) {
        vscode.window.showErrorMessage(
            `Failed to list clusters in subscription ${subscriptionId}: ${clusterResources.error}`,
        );
        return { status: "error", message: clusterResources.error, clusterName: "", clusterId: "" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clusterItems: any[] = (clusterResources as unknown as Succeeded<DefinedResourceWithGroup[]>).result.map(
        (cluster) => {
            return {
                label: cluster.name || "",
                description: cluster.id,
                picked: (clusterResources as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(
                    (clusterItem) => clusterItem.name === cluster.name,
                ), // Set to true if the cluster is in clusterResources,
                subscription: {
                    subscriptionId: subscriptionId || "",
                    tenantId: cluster.identity?.tenantId || "",
                },
            };
        },
    );

    const selectedClusterItem = await vscode.window.showQuickPick(clusterItems, {
        canPickMany: false,
        placeHolder: "Select existing AKS Cluster in subscription",
    });

    if (!selectedClusterItem) {
        return { status: "cancelled", clusterName: "", clusterId: "" };
    }

    return { status: "success", clusterName: selectedClusterItem.label, clusterId: selectedClusterItem.description };
}
const setClusterContextPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs<typeof setClusterContextFunctionName, Parameters>) => {
        const pluginRequest = args.localPluginRequest;

        if (pluginRequest.functionName === setClusterContextFunctionName) {
            const sessionProvider = await getReadySessionProvider();
            const kubectl = await k8s.extension.kubectl.v1;
            const cloudExplorer = await k8s.extension.cloudExplorer.v1;
            const clusterExplorer = await k8s.extension.clusterExplorer.v1;
        
            if (failed(sessionProvider)) {
                vscode.window.showErrorMessage(sessionProvider.error);
                return {status: "error", message: sessionProvider.error};
            }
        
            if (!kubectl.available) {
                vscode.window.showWarningMessage(`Kubectl is unavailable.`);
                return {status: "error", message: "Kubectl is unavailable."};
            }
        
            if (!cloudExplorer.available) {
                vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
                return {status: "error", message: "Cloud explorer is unavailable."};
            }
        
            if (!clusterExplorer.available) {
                vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
                return {status: "error", message: "Cluster explorer is unavailable."};
            }
        
            const selectedSubscription = await getSubscriptionResult(sessionProvider.result);
        
            if (selectedSubscription.status === "cancelled") {
                return {status: "cancelled"};
            }
        
            if (selectedSubscription.status === "error") {
                return { status: "error", message: selectedSubscription.message};
            }
        
            const selectedClusterItem = await getExistingCluster(
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

            return {status: "success", message: `Current cluster : ${parsedCurrentCluster.clusterName} under subscription: ${parsedCurrentCluster.subscriptionName}`};

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