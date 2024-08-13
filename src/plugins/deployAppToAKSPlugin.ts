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
import { getEnvironment, getReadySessionProvider } from "../auth/azureAuth";
import { getSubscriptions, SelectionType } from "../commands/utils/subscriptions";
import { failed, getErrorMessage, Succeeded } from "../commands/utils/errorable";
import { QuickPickItem } from "vscode";
import { SubscriptionFilter } from "../commands/utils/config";
import { DefinedResourceWithGroup, getResources } from "../commands/utils/azureResources";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAksClient, getResourceManagementClient } from "../commands/utils/arm";
import { parseResource } from "../azure-api-utils";
import { DefinedManagedCluster, getKubeconfigYaml } from "../commands/utils/clusters";
import * as tmpfile from "../commands/utils/tempfile";
import { longRunning } from "../commands/utils/host";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { getPortalResourceUrl } from "../commands/utils/env";
import { getResourceGroups } from "../commands/utils/resourceGroups";
import {
    AutomaticAKSClusterSpec,
    AutomaticClusterDeploymentBuilder,
} from "../panels/utilities/AutomaticClusterSpecCreationBuilder";
import { RestError } from "@azure/storage-blob";
import { exec } from "../commands/utils/shell";

type SubscriptionQuickPickItem = QuickPickItem & { subscription: SubscriptionFilter };

const deployAppToAKSFunctionName = "deployAppToAKS";
type Parameters = {
    resourceContext: string;
    queryAppLogsIntent: string;
};

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

    const allSubscriptions = await getSubscriptions(sessionProvider.result, SelectionType.All);
    if (failed(allSubscriptions)) {
        vscode.window.showErrorMessage(allSubscriptions.error);
        return { status: "error", message: allSubscriptions.error };
    }

    if (allSubscriptions.result.length === 0) {
        const noSubscriptionsFound = "No subscriptions were found. Set up your account if you have yet to do so.";
        const setupAccount = "Set up Account";
        const response = await vscode.window.showInformationMessage(noSubscriptionsFound, setupAccount);
        if (response === setupAccount) {
            vscode.env.openExternal(vscode.Uri.parse("https://azure.microsoft.com/"));
        }

        return { status: "error", message: noSubscriptionsFound };
    }
    const session = await sessionProvider.result.getAuthSession();
    if (failed(session)) {
        vscode.window.showErrorMessage(session.error);
        return { status: "error", message: session.error };
    }

    const filteredSubscriptions: SubscriptionFilter[] = await allSubscriptions.result
        .filter((sub) => sub.tenantId === session.result.tenantId)
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
        return { status: "cancelled" };
    }

    const client = getAksClient(sessionProvider.result, selectedSubscription.subscription.subscriptionId);

    //Select cluster
    agentRequest.responseStream.progress("Select an AKS cluster ...");
    let selectedCluster: string | undefined = undefined;
    let selectedClusterId: string | undefined = undefined;
    const createNewAutomaticCluster = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
        title: `Do you want to create a new Automatic AKS cluster for this deployment?`,
        placeHolder: "Select option ...",
    });

    if (createNewAutomaticCluster && createNewAutomaticCluster.label === "Yes") {
        agentRequest.responseStream.progress("Creating automatic AKS cluster ...");

        // select resource group
        const resourceGroups = await getResourceGroups(
            sessionProvider.result,
            selectedSubscription.subscription.subscriptionId,
        );

        if (failed(resourceGroups)) {
            vscode.window.showErrorMessage(
                `Failed to list resource groups in subscription ${selectedSubscription.subscription.subscriptionId}: ${resourceGroups.error}`,
            );
        }

        const rgItems: QuickPickItem[] = (
            resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>
        ).result.map((rg) => {
            return {
                label: rg.name || "",
                description: rg.id,
                picked: false, //(resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(rgName => rgName === cluster.name), // Set to true if the cluster is in clusterResources,
            };
        });

        const selectedResourceGroup = await vscode.window.showQuickPick(rgItems, {
            canPickMany: false,
            placeHolder: "Select resource group for the new AKS Cluster",
        });

        // select location
        const resourceManagementClient = getResourceManagementClient(
            sessionProvider.result,
            selectedSubscription.subscription.subscriptionId,
        );
        const provider = await resourceManagementClient.providers.get("Microsoft.ContainerService");
        const resourceTypes = provider.resourceTypes?.filter((t) => t.resourceType === "managedClusters");
        if (!resourceTypes || resourceTypes.length > 1) {
            vscode.window.showErrorMessage(
                `Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`,
            );
            return {
                status: "error",
                message: `Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`,
            };
        }

        const resourceType = resourceTypes[0];
        if (!resourceType.locations || resourceType.locations.length === 0) {
            vscode.window.showErrorMessage("No locations for managedClusters resource type.");
            return { status: "error", message: "No locations for managedClusters resource type." };
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
            return { status: "cancelled", message: "No location selected." };
        }
        // create automatic aks name

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
            return { status: "cancelled", message: "No cluster name provided." };
        }

        const clusterSpec: AutomaticAKSClusterSpec = {
            location: selectedLocation.label,
            name: resourceName,
            resourceGroupName: selectedResourceGroup?.label || "",
            subscriptionId: selectedSubscription.subscription.subscriptionId,
        };

        // Create a unique deployment name.
        const deploymentName = `${resourceName}-${Math.random().toString(36).substring(5)}`;
        const deploymentSpec = new AutomaticClusterDeploymentBuilder()
            .buildCommonParameters(clusterSpec)
            .buildTemplate("automatic")
            .getDeployment();

        console.log("deploymentName: ", deploymentName);

        try {
            const poller = await resourceManagementClient.deployments.beginCreateOrUpdate(
                selectedResourceGroup?.label || "",
                deploymentName,
                deploymentSpec,
            );

            agentRequest.responseStream.progress(
                "Deploying your new AKS cluster. This operation takes 5-10 minutes to complete ...",
            );

            poller.onProgress(async (state) => {
                if (state.status === "canceled") {
                    vscode.window.showWarningMessage(`Creating AKS cluster ${resourceName} was cancelled.`);
                    return { status: "cancelled", message: "Creating AKS cluster was cancelled." };
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    console.log("state.error: ", state.error);
                    vscode.window.showErrorMessage(`Error creating AKS cluster ${deploymentName}: ${errorMessage}`);
                    const deploymentResult = await exec(
                        `az deployment operation group list -g ${selectedResourceGroup?.label} --name ${deploymentName}`,
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
                    vscode.window.showInformationMessage(`Successfully created AKS cluster ${resourceName}.`);
                    agentRequest.responseStream.progress("Successfully deployed your new AKS cluster.");
                    return state;
                }
                return state;
            });

            const res = await poller.pollUntilDone();
            selectedCluster = resourceName;
            selectedClusterId = res.properties?.outputResources?.[0]?.id;
        } catch (ex) {
            const errorMessage = isInvalidTemplateDeploymentError(ex)
                ? getInvalidTemplateErrorMessage(ex)
                : getErrorMessage(ex);
            vscode.window.showErrorMessage(`Error creating AKS cluster ${resourceName}: ${errorMessage}`);
        }
    } else {
        const clusterResources = await getResources(
            sessionProvider.result,
            selectedSubscription.subscription.subscriptionId,
            "Microsoft.ContainerService/managedClusters",
        );

        if (failed(clusterResources)) {
            vscode.window.showErrorMessage(
                `Failed to list clusters in subscription ${selectedSubscription.subscription.subscriptionId}: ${clusterResources.error}`,
            );
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
                        subscriptionId: selectedSubscription.subscription.subscriptionId || "",
                        tenantId: cluster.identity?.tenantId || "",
                    },
                };
            },
        );

        const selectedClusterItem = await vscode.window.showQuickPick(clusterItems, {
            canPickMany: false,
            placeHolder: "Select existing AKS Cluster in subscription",
        });

        selectedCluster = selectedClusterItem.label;
        selectedClusterId = selectedClusterItem.description;
    }

    if (!selectedCluster || !selectedClusterId) {
        return { status: "cancelled", message: "No cluster selected." };
    }

    // Select manifest file
    agentRequest.responseStream.progress("Select a manifest file for deployment ...");

    const items: vscode.QuickPickItem[] = [];
    await vscode.workspace.findFiles("**/*.yaml", "**/node_modules/**").then((result) => {
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
        return { status: "cancelled" };
    }

    // Confirm deployment
    const confirmDeployment = await vscode.window.showQuickPick([{ label: "Yes" }, { label: "No" }], {
        title: `Do you want to deploy to this cluster: ${selectedCluster}?`,
        placeHolder: "Select option ...",
    });
    if (confirmDeployment && confirmDeployment.label === "No") {
        vscode.window.showErrorMessage("Deployment operation cancelled");
        return { status: "cancelled" };
    }

    // start deplopyment
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
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
        sessionProvider.result,
        selectedSubscription.subscription.subscriptionId,
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
        return await invokeKubectlCommand(kubectl, kubeConfigFile.filePath, `apply -f ${fileSelected.description}`);
    });

    if (failed(result)) {
        vscode.window.showErrorMessage(`Failed to deploy application to the cluster: ${result.error}`);
        return { status: "error", message: result.error };
    }

    const resourceUrl = getPortalResourceUrl(getEnvironment(), managedCluster.id);

    return {
        result: "success",
        message: `Successfully deployed application to the cluster. To view status of the resource, click [here](${resourceUrl}).`,
    };
}

type InvalidTemplateDeploymentRestError = RestError & {
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

function getInvalidTemplateErrorMessage(ex: InvalidTemplateDeploymentRestError): string {
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

function isInvalidTemplateDeploymentError(ex: unknown): ex is InvalidTemplateDeploymentRestError {
    return isRestError(ex) && ex.code === "InvalidTemplateDeployment";
}

function isRestError(ex: unknown): ex is RestError {
    return typeof ex === "object" && ex !== null && ex.constructor.name === "RestError";
}

const deployAppToAKSPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs<typeof deployAppToAKSFunctionName, Parameters>) => {
        const pluginRequest = args.localPluginRequest;

        if (pluginRequest.functionName === deployAppToAKSFunctionName) {
            console.log("args: ", args);
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
