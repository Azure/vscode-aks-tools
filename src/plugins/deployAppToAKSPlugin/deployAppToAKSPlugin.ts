import {
    AgentRequest,
    ILocalPluginHandler,
    LocalPluginArgs,
    LocalPluginEntry,
    LocalPluginManifest,
    LocalPluginResult,
} from "copilot-for-azure-vscode-api";
import * as vscode from "vscode";
import * as path from "path";
import { getEnvironment, getReadySessionProvider } from "../../auth/azureAuth";
import { getSubscriptions, SelectionType } from "../../commands/utils/subscriptions";
import { failed, getErrorMessage, Succeeded } from "../../commands/utils/errorable";
import { QuickPickItem } from "vscode";
import { SubscriptionFilter } from "../../commands/utils/config";
import { DefinedResourceWithGroup, getResources } from "../../commands/utils/azureResources";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAksClient, getResourceManagementClient } from "../../commands/utils/arm";
import { parseResource } from "../../azure-api-utils";
import { DefinedManagedCluster, getKubeconfigYaml } from "../../commands/utils/clusters";
import * as tmpfile from "../../commands/utils/tempfile";
import { longRunning } from "../../commands/utils/host";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { getPortalResourceUrl } from "../../commands/utils/env";
import { getResourceGroups } from "../../commands/utils/resourceGroups";
import {
    AutomaticAKSClusterSpec,
    AutomaticClusterDeploymentBuilder,
} from "../../panels/utilities/AutomaticClusterSpecCreationBuilder";
import { exec } from "../../commands/utils/shell";
import { isInvalidTemplateDeploymentError, getInvalidTemplateErrorMessage } from "./deployAppToAKSPluginHelper";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { ResourceManagementClient } from "@azure/arm-resources";
import { ContainerServiceClient } from "@azure/arm-containerservice";

type SubscriptionQuickPickItem = QuickPickItem & { subscription: SubscriptionFilter };

type SuccessResult = { status: "success"; message?: string };
type ErrorResult = { status: "error"; message: string };
type CancelledResult = { status: "cancelled" };

type ReturnResult = SuccessResult | ErrorResult | CancelledResult;
type SubscriptionSelectionResult = { subscriptionName: string; subscriptionId: string } & ReturnResult;

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

type ResourceGroupSelectionResult = { resourceGroupName: string } & ReturnResult;
async function getResourceGroupResult(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<ResourceGroupSelectionResult> {
    const resourceGroups = await getResourceGroups(sessionProvider, subscriptionId);

    if (failed(resourceGroups)) {
        vscode.window.showErrorMessage(resourceGroups.error);
        return { status: "error", message: resourceGroups.error, resourceGroupName: "" };
    }

    const rgItems: QuickPickItem[] = (resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>).result.map(
        (rg) => {
            return {
                label: rg.name || "",
                description: rg.id,
                picked: false, //(resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(rgName => rgName === cluster.name), // Set to true if the cluster is in clusterResources,
            };
        },
    );

    const selectedResourceGroup = await vscode.window.showQuickPick(rgItems, {
        canPickMany: false,
        placeHolder: "Select resource group for the new AKS Cluster",
    });

    if (!selectedResourceGroup) {
        return { status: "cancelled", resourceGroupName: "" };
    }

    return { status: "success", resourceGroupName: selectedResourceGroup.label };
}

type LocationSelectionResult = { location: string } & ReturnResult;
async function getLocationResult(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<LocationSelectionResult> {
    const resourceManagementClient = getResourceManagementClient(sessionProvider, subscriptionId);
    const provider = await resourceManagementClient.providers.get("Microsoft.ContainerService");
    const resourceTypes = provider.resourceTypes?.filter((t) => t.resourceType === "managedClusters");
    if (!resourceTypes || resourceTypes.length > 1) {
        vscode.window.showErrorMessage(
            `Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`,
        );
        return {
            status: "error",
            message: `Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`,
            location: "",
        };
    }

    const resourceType = resourceTypes[0];
    if (!resourceType.locations || resourceType.locations.length === 0) {
        vscode.window.showErrorMessage("No locations for managedClusters resource type.");
        return { status: "error", message: "No locations for managedClusters resource type.", location: "" };
    }

    const locationItems: QuickPickItem[] = resourceType.locations.map((location) => {
        return {
            label: location || "",
            description: "",
            picked: true, //(resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(rgName => rgName === cluster.name), // Set to true if the cluster is in clusterResources,
        };
    });

    const selectedLocation = await vscode.window.showQuickPick(locationItems, {
        canPickMany: false,
        placeHolder: "Select location for the new AKS Cluster",
    });

    if (!selectedLocation) {
        return { status: "cancelled", location: "" };
    }

    return { status: "success", location: selectedLocation.label };
}

async function getNewAKSClusterName(): Promise<string> {
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

async function deployNewCluster(agentRequest: AgentRequest, resourceManagementClient: ResourceManagementClient, clusterSpec: AutomaticAKSClusterSpec): Promise<ClusterResult> {
    
    // Create a unique deployment name.
    const deploymentName = `${clusterSpec.name}-${Math.random().toString(36).substring(5)}`;
    const deploymentSpec = new AutomaticClusterDeploymentBuilder()
        .buildCommonParameters(clusterSpec)
        .buildTemplate("automatic")
        .getDeployment();

    console.log("deploymentName: ", deploymentName);

    try {
        const poller = await resourceManagementClient.deployments.beginCreateOrUpdate(
            clusterSpec.resourceGroupName,
            deploymentName,
            deploymentSpec,
        );

        agentRequest.responseStream.progress("Deploying your new AKS cluster. This might take a few minutes ...",);

        poller.onProgress(async (state) => {
            if (state.status === "canceled") {
                vscode.window.showWarningMessage(`Creating AKS cluster ${clusterSpec.name} was cancelled.`);
                return { status: "cancelled", message: "Creating AKS cluster was cancelled." };
            } else if (state.status === "failed") {
                const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                console.log("state.error: ", state.error);
                vscode.window.showErrorMessage(`Error creating AKS cluster ${deploymentName}: ${errorMessage}`);
                const deploymentResult = await exec(
                    `az deployment operation group list -g ${clusterSpec.resourceGroupName} --name ${deploymentName}`,
                );

                if (failed(deploymentResult)) {
                    vscode.window.showErrorMessage(deploymentResult.error);
                    return;
                }
                console.log("deploymentResult: ", JSON.parse(deploymentResult.result.stdout));

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
            return { status: "error", message: `Failed to get resource id for AKS cluster ${clusterSpec.name}.`, clusterName: "", clusterId: "" };
        }

        return { status: "success", clusterName: clusterSpec.name, clusterId: resourceId };

    } catch (ex) {
        const errorMessage = isInvalidTemplateDeploymentError(ex) ? getInvalidTemplateErrorMessage(ex) : getErrorMessage(ex);
        vscode.window.showErrorMessage(`Error creating AKS cluster ${clusterSpec.name}: ${errorMessage}`);
        return { status: "error", message: `Error creating AKS cluster ${clusterSpec.name}: ${errorMessage}`, clusterName: "", clusterId: "" };
    }
}

async function shouldCreateNewAutomaticCluster(): Promise<boolean> {
    const shouldGetExistingCluster = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
        title: `Do you want to create a new Automatic AKS cluster for this deployment?`,
        placeHolder: "Select option ...",
    });
    if (!shouldGetExistingCluster) {
        vscode.window.showErrorMessage("Error selecting option");
        return false;
    }

    return shouldGetExistingCluster.label === "Yes";
}

type DeployApplicationToClusterResult = {url?: string} & ReturnResult
type DeployApplicationToClusterParams = {
    client: ContainerServiceClient;
    sessionProvider: ReadyAzureSessionProvider;
    subscriptionId: string;
    selectedCluster: string;
    selectedClusterId: string;
    fileURISelection: string;
    agentRequest: AgentRequest;
};
async function deployApplicationToCluster(params: DeployApplicationToClusterParams) : Promise<DeployApplicationToClusterResult> {

    const { client, sessionProvider, subscriptionId, selectedCluster, selectedClusterId, fileURISelection, agentRequest } = params;

    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return { status: "error", message: "Cloud explorer is unavailable." };
    }

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return { status: "error", message: "Kubectl is unavailable." };
    }

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
    if (failed(kubeconfigYaml)) {
        return { status: "error", message: kubeconfigYaml.error };
    }

    const kubeConfigFile = await tmpfile.createTempFile(kubeconfigYaml.result, "yaml");

    //Deploy app using kubectl
    agentRequest.responseStream.progress(`Deploying your application to AKS cluster: ${selectedCluster}.`);

    const result = await longRunning(`Deploying application to cluster ${selectedCluster}.`, async () => {
        return await invokeKubectlCommand(kubectl, kubeConfigFile.filePath, `apply -f ${fileURISelection}`);
    });

    if (failed(result)) {
        vscode.window.showErrorMessage(`Failed to deploy application to the cluster: ${result.error}`);
        return { status: "error", message: result.error };
    }

    const resourceUrl = getPortalResourceUrl(getEnvironment(), managedCluster.id);
    return { status: "success", url: resourceUrl };
}

type ConfirmDeploymentResult = {result: boolean} & ReturnResult;
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

async function getManifestFile(): Promise<string|undefined> {
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

async function handleDeployment(agentRequest: AgentRequest): Promise<LocalPluginResult> {
    agentRequest.responseStream.progress("Invoking AKS extension ...");

    if (agentRequest.token.isCancellationRequested) {
        return { status: "cancelled" };
    }

    //Select subscription
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return { status: "error", message: sessionProvider.error };
    }

    agentRequest.responseStream.progress("Select subscription ...");
    const selectedSubscription = await getSubscriptionResult(sessionProvider.result);

    if (selectedSubscription.status === "cancelled") {
        return { status: "cancelled" };
    }

    if (selectedSubscription.status === "error") {
        return { status: "error", message: selectedSubscription.message };
    }

    const client = getAksClient(sessionProvider.result, selectedSubscription.subscriptionId);

    const resourceManagementClient = getResourceManagementClient(
        sessionProvider.result,
        selectedSubscription.subscriptionId,
    );

    //Select cluster
    let selectedCluster: string | undefined = undefined;
    let selectedClusterId: string | undefined = undefined;

    const shouldCreateNewCluster = await shouldCreateNewAutomaticCluster();

    if (shouldCreateNewCluster) {
        agentRequest.responseStream.progress("Creating automatic AKS cluster ...");

        // select resource group
        const selectedResourceGroup = await getResourceGroupResult(
            sessionProvider.result,
            selectedSubscription.subscriptionId,
        );
        if (selectedResourceGroup.status === "cancelled") {
            return { status: "cancelled" };
        }

        if (selectedResourceGroup.status === "error") {
            return { status: "error", message: selectedResourceGroup.message };
        }

        // select location
        const selectedLocation = await getLocationResult(sessionProvider.result, selectedSubscription.subscriptionId);
        if (selectedLocation.status === "cancelled") {
            return { status: "cancelled" };
        }

        if (selectedLocation.status === "error") {
            return { status: "error", message: selectedLocation.message };
        }

        // create automatic aks name
        const resourceName = await getNewAKSClusterName();
        if (!resourceName) {
            return { status: "cancelled" };
        }

        // deploy aks cluster
        const clusterSpec: AutomaticAKSClusterSpec = {
            location: selectedLocation.location,
            name: resourceName,
            resourceGroupName: selectedResourceGroup.resourceGroupName,
            subscriptionId: selectedSubscription.subscriptionId,
        };

        const deployClusterResult = await deployNewCluster(agentRequest, resourceManagementClient, clusterSpec);
        if (deployClusterResult.status === "cancelled") {
            return { status: "cancelled" };
        }

        if (deployClusterResult.status === "error") {
            return { status: "error", message: deployClusterResult.message };
        }

        selectedCluster = deployClusterResult.clusterName;
        selectedClusterId = deployClusterResult.clusterId;

    } else {
        agentRequest.responseStream.progress("Select an AKS cluster ...");
        const selectedClusterItem = await getExistingCluster(
            sessionProvider.result,
            selectedSubscription.subscriptionId,
        );

        selectedCluster = selectedClusterItem.clusterName;
        selectedClusterId = selectedClusterItem.clusterId;
    }

    if (!selectedCluster || !selectedClusterId) {
        return { status: "cancelled", message: "No cluster selected." };
    }

    // Select manifest file
    agentRequest.responseStream.progress("Select a manifest file for deployment ...");

    const selectedManifestFile = await getManifestFile();

    if (!selectedManifestFile) {
        return { status: "cancelled" };
    }

    
    // Confirm deployment
    const confirmDeploymentResult = await confirmDeployment(selectedCluster);

    if (confirmDeploymentResult.status === "cancelled") {
        return { status: "cancelled", message: "Deployment operation cancelled." };
    }

    // start application deplopyment
    const deployApplicationResult = await deployApplicationToCluster({
        client,
        sessionProvider: sessionProvider.result,
        subscriptionId: selectedSubscription.subscriptionId,
        selectedCluster: selectedCluster,
        selectedClusterId: selectedClusterId,
        fileURISelection: selectedManifestFile,
        agentRequest: agentRequest,
    });

    if(deployApplicationResult.status === "cancelled") {    
        return { status: "cancelled", message: "Deployment operation cancelled." };
    }

    if (deployApplicationResult.status === "error") {
        return { status: "error", message: deployApplicationResult.message };
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
