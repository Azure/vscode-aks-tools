import {
    AgentRequest,
    ILocalPluginHandler,
    LocalPluginArgs,
    LocalPluginEntry,
    LocalPluginManifest,
    LocalPluginResult,
} from "copilot-for-azure-vscode-api";
import * as vscode from "vscode";
import { getEnvironment, getReadySessionProvider } from "../../auth/azureAuth";
import { failed } from "../../commands/utils/errorable";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAksClient, getResourceManagementClient } from "../../commands/utils/arm";
import { parseResource } from "../../azure-api-utils";
import { CurrentClusterContext, DefinedManagedCluster, getKubeconfigYaml } from "../../commands/utils/clusters";
import * as tmpfile from "../../commands/utils/tempfile";
import { longRunning } from "../../commands/utils/host";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { getPortalResourceUrl } from "../../commands/utils/env";
import { AutomaticAKSClusterSpec } from "../../panels/utilities/AutomaticClusterSpecCreationBuilder";
import { getManifestFile, deployNewAKSCluster, getNewAKSClusterName } from "./deployAppToAKSPluginHelper";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import {
    getLocationFromResourceGroup,
    getResourceGroupSelection,
    getSubscriptionSelection,
    isErrorOrCancelled,
    ReturnResult,
} from "../common/pluginHelpers";
import { getAssetContext } from "../../assets";

async function shouldCreateNewCluster(): Promise<boolean> {
    let clusterName = "";
    const context = getAssetContext();
    const currentCluster = (await context.globalState.get("currentCluster")) as string;

    if (currentCluster) {
        const parsedCurrentCluster = JSON.parse(currentCluster) as CurrentClusterContext;
        clusterName = parsedCurrentCluster.clusterName;
    }

    const shouldGetExistingCluster = await vscode.window.showQuickPick(
        [
            { label: `Current AKS cluster ${clusterName ? `(${clusterName})` : ""}` },
            { label: "Create new AKS cluster" },
        ],
        {
            title: `Which AKS cluster do you want to deploy to?`,
            placeHolder: "Select option ...",
        },
    );
    if (!shouldGetExistingCluster) {
        vscode.window.showErrorMessage("Error selecting option");
        return false;
    }

    return !shouldGetExistingCluster.label.includes("Current");
}

type DeployApplicationToClusterResult = { url?: string } & ReturnResult;
type DeployApplicationToClusterParams = {
    client: ContainerServiceClient;
    sessionProvider: ReadyAzureSessionProvider;
    subscriptionId: string;
    subscriptionName: string;
    selectedCluster: string;
    selectedClusterId: string;
    kubeConfig: string | undefined;
    manifestPath: string;
    agentRequest: AgentRequest;
};
async function deployApplicationToCluster(
    params: DeployApplicationToClusterParams,
): Promise<DeployApplicationToClusterResult> {
    const {
        client,
        sessionProvider,
        subscriptionId,
        subscriptionName,
        selectedCluster,
        selectedClusterId,
        kubeConfig,
        manifestPath,
        agentRequest,
    } = params;

    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return { status: "error", message: "Kubectl is unavailable." };
    }

    let kubeConfigYamlResult: string | undefined = undefined;

    if (!kubeConfig) {
        let managedCluster = undefined;
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
            return { status: "error", message: `Failed to get managed cluster: ${selectedCluster}` };
        }

        // Get KubeConfig file
        const kubeconfigYaml = await getKubeconfigYaml(
            sessionProvider,
            subscriptionId,
            parseResource(selectedClusterId).resourceGroupName!,
            managedCluster!,
        );

        if (failed(kubeconfigYaml) || !kubeconfigYaml) {
            return { status: "error", message: kubeconfigYaml.error };
        }

        kubeConfigYamlResult = kubeconfigYaml.result;

        // Ask if user wants to save new cluster context.
        vscode.window
            .showInformationMessage("Do you want to do save new cluster to VSCode context?", "Yes", "No")
            .then((answer) => {
                if (answer === "Yes") {
                    const context = getAssetContext();
                    const newCluster: CurrentClusterContext = {
                        clusterId: selectedClusterId,
                        clusterName: selectedCluster,
                        resourceGroup: parseResource(selectedClusterId).resourceGroupName!,
                        subscriptionId: subscriptionId,
                        kubeConfig: kubeConfigYamlResult,
                        subscriptionName: subscriptionName,
                    };
                    context.globalState.update("currentCluster", JSON.stringify(newCluster));
                    vscode.window.showInformationMessage("New AKS cluster context saved.");
                }
            });
    } else {
        kubeConfigYamlResult = kubeConfig;
    }

    if (!kubeConfigYamlResult) {
        return { status: "error", message: "Failed to get kubeconfig yaml." };
    }

    const kubeConfigFile = await tmpfile.createTempFile(kubeConfigYamlResult, "yaml");

    //Deploy app using kubectl
    agentRequest.responseStream.progress(`Deploying your application to AKS cluster: ${selectedCluster}.`);

    const result = await longRunning(`Deploying application to cluster ${selectedCluster}.`, async () => {
        return await invokeKubectlCommand(kubectl, kubeConfigFile.filePath, `apply -f ${manifestPath}`);
    });

    if (failed(result)) {
        vscode.window.showErrorMessage(`Failed to deploy application to the cluster: ${result.error}`);
        return { status: "error", message: result.error };
    }

    const resourceUrl = getPortalResourceUrl(getEnvironment(), selectedClusterId);
    return { status: "success", url: resourceUrl };
}

type ConfirmDeploymentResult = { result: boolean } & ReturnResult;
async function confirmDeployment(clusterName: string): Promise<ConfirmDeploymentResult> {
    const confirmDeployment = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
        title: `Do you want to deploy to this cluster: ${clusterName}?`,
        placeHolder: "Select option ...",
    });

    if (confirmDeployment && confirmDeployment.label === "No") {
        vscode.window.showErrorMessage("Deployment operation cancelled");
        return { status: "cancelled", result: false };
    }

    return { status: "success", result: true };
}

async function handleDeployment(agentRequest: AgentRequest): Promise<LocalPluginResult> {
    agentRequest.responseStream.progress("Invoking Azure Kubernetes extension ...");

    if (agentRequest.token.isCancellationRequested) {
        return { status: "cancelled" };
    }
    const sessionProvider = await getReadySessionProvider();
    const context = getAssetContext();
    const currentCluster = (await context.globalState.get("currentCluster")) as string;
    const parsedCurrentCluster = currentCluster ? (JSON.parse(currentCluster) as CurrentClusterContext) : undefined;

    if (failed(sessionProvider)) {
        return { status: "error", message: sessionProvider.error };
    }
    //Select cluster
    let selectedCluster: string | undefined = undefined;
    let selectedClusterId: string | undefined = undefined;
    let selectedSubscriptionId: string | undefined = undefined;
    let selectedSubscriptionName: string | undefined = undefined;
    let selectedResourceGroupName: string | undefined = undefined;
    let kubeConfig: string | undefined = undefined;

    const shouldCreateNewClusterResult = await shouldCreateNewCluster();

    if (shouldCreateNewClusterResult) {
        agentRequest.responseStream.progress("Creating automatic AKS cluster ...");

        // select subscription
        let useCurrentSubscriptionAndResourceGroup = undefined;

        if (parsedCurrentCluster && parsedCurrentCluster.subscriptionId) {
            useCurrentSubscriptionAndResourceGroup = await vscode.window.showQuickPick(
                [{ label: "Yes" }, { label: "No" }],
                {
                    title: `Do you want to use default subscription and resource group?`,
                    placeHolder: `Subscription: (${parsedCurrentCluster.subscriptionId}) Resource group: (${parsedCurrentCluster.resourceGroup})`,
                },
            );
        }

        if (parsedCurrentCluster && useCurrentSubscriptionAndResourceGroup?.label === "Yes") {
            selectedSubscriptionId = parsedCurrentCluster.subscriptionId;
            selectedSubscriptionName = parsedCurrentCluster.subscriptionName;
            selectedResourceGroupName = parsedCurrentCluster.resourceGroup;
        } else {

            // select subscription
            const selectedSubscription = await getSubscriptionSelection(sessionProvider.result);
            if (isErrorOrCancelled(selectedSubscription)) {
                return { status: selectedSubscription.status, message: selectedSubscription.message };
            }
            selectedSubscriptionId = selectedSubscription.subscriptionId;
            selectedSubscriptionName = selectedSubscription.subscriptionName;

            // select resource group
            const selectedResourceGroup = await getResourceGroupSelection(
                sessionProvider.result,
                selectedSubscriptionId || "",
            );

            if (isErrorOrCancelled(selectedResourceGroup)) {
                return { status: selectedResourceGroup.status, message: selectedResourceGroup.message };
            }

            selectedResourceGroupName = selectedResourceGroup.resourceGroupName;
        }

        // get location from resource group by default
        const selectedLocation = await getLocationFromResourceGroup(
            sessionProvider.result,
            selectedSubscriptionId,
            selectedResourceGroupName,
        );

        // create automatic aks name
        const resourceName = await getNewAKSClusterName();

        if (!resourceName || !selectedSubscriptionId || !selectedResourceGroupName || !selectedLocation) {
            return { status: "cancelled", message: "Subscription, or resource group was not selected for deployment." };
        }

        // deploy aks cluster
        const clusterSpec: AutomaticAKSClusterSpec = {
            location: selectedLocation,
            name: resourceName,
            resourceGroupName: selectedResourceGroupName,
            subscriptionId: selectedSubscriptionId,
        };
        const resourceManagementClient = getResourceManagementClient(sessionProvider.result, selectedSubscriptionId);

        const deployClusterResult = await deployNewAKSCluster(agentRequest, resourceManagementClient, clusterSpec);

        if (isErrorOrCancelled(deployClusterResult)) {
            return { status: deployClusterResult.status, message: deployClusterResult.message };
        }

        selectedCluster = deployClusterResult.clusterName;
        selectedClusterId = deployClusterResult.clusterId;

    } else {
        const currentCluster = parsedCurrentCluster;

        if (!currentCluster) {
            vscode.window.showErrorMessage("AKS cluster is not set. Please set the AKS cluster first.");
            return { status: "error", message: "AKS cluster is not set. Please set the AKS cluster first." };
        }

        agentRequest.responseStream.progress(`Using current AKS cluster: ${parsedCurrentCluster.clusterName}...`);

        selectedCluster = parsedCurrentCluster.clusterName;
        selectedClusterId = parsedCurrentCluster.clusterId;
        selectedSubscriptionId = parsedCurrentCluster.subscriptionId;
        selectedSubscriptionName = parsedCurrentCluster.subscriptionName;
        kubeConfig = parsedCurrentCluster.kubeConfig;
    }

    if (!selectedCluster || !selectedClusterId) {
        return { status: "cancelled", message: "No cluster selected." };
    }

    if (!selectedSubscriptionId) {
        return { status: "error", message: "No subscription selected." };
    }

    // Select manifest file
    agentRequest.responseStream.progress("Select application manifest file ...");
    const selectedManifestFile = await getManifestFile();

    if (!selectedManifestFile) {
        return { status: "cancelled" };
    }

    // Confirm deployment
    const confirmDeploymentResult = await confirmDeployment(selectedCluster);
    if (isErrorOrCancelled(confirmDeploymentResult)) {
        return { status: confirmDeploymentResult.status, message: confirmDeploymentResult.message };
    }

    const client = getAksClient(sessionProvider.result, selectedSubscriptionId);

    // start application deplopyment
    const deployApplicationResult = await deployApplicationToCluster({
        client,
        sessionProvider: sessionProvider.result,
        subscriptionId: selectedSubscriptionId,
        subscriptionName: selectedSubscriptionName,
        selectedCluster: selectedCluster,
        selectedClusterId: selectedClusterId,
        kubeConfig: kubeConfig,
        manifestPath: selectedManifestFile,
        agentRequest: agentRequest,
    });

    if (isErrorOrCancelled(deployApplicationResult)) {
        return { status: deployApplicationResult.status, message: deployApplicationResult.message };
    }

    return {
        result: "success",
        message: `Successfully deployed application to the AKS cluster. To view the resource, click [here](${deployApplicationResult.url}).`,
    };
}

const deployAppToAKSFunctionName = "deployAppToAKS";
// eslint-disable-next-line @typescript-eslint/ban-types
type Parameters = {};

const deployAppToAKSPluginManifest: LocalPluginManifest = {
    name: "DeployAppToAKSPlugin",
    version: "1.0.0",
    functions: [
        {
            name: deployAppToAKSFunctionName,
            description: "Run Azure VSCode extension command - deploy application to AKS cluster.",
            parameters: [],
            returnParameter: {
                description: "Return message of the command execution.",
                type: "string",
            },
            willHandleUserResponse: false,
        },
    ],
    applicableTopicScopes: [],
};

const deployAppToAKSPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs<typeof deployAppToAKSFunctionName, Parameters>) => {
        const pluginRequest = args.localPluginRequest;

        if (pluginRequest.functionName === deployAppToAKSFunctionName) {
            return await handleDeployment(args.agentRequest);
        }

        return {
            status: "error",
            message: "Unrecognized command.",
        };
    },
};

export const deployAppToAKSPlugin: LocalPluginEntry = {
    manifest: deployAppToAKSPluginManifest,
    handler: deployAppToAKSPluginHandler,
};
