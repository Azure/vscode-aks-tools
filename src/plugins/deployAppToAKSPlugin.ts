import { AgentRequest, ILocalPluginHandler, LocalPluginArgs, LocalPluginEntry, LocalPluginManifest, LocalPluginResult } from "copilot-for-azure-vscode-api";
import * as vscode from "vscode";
import * as path from "path";
import { getEnvironment, getReadySessionProvider } from "../auth/azureAuth";
import { getSubscriptions, SelectionType } from "../commands/utils/subscriptions";
import { failed, Succeeded } from "../commands/utils/errorable";
import { QuickPickItem } from "vscode";
import { SubscriptionFilter } from "../commands/utils/config";
import { DefinedResourceWithGroup, getResources } from "../commands/utils/azureResources";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAksClient } from "../commands/utils/arm";
import { parseResource } from "../azure-api-utils";
import { DefinedManagedCluster, getKubeconfigYaml } from "../commands/utils/clusters";
import * as tmpfile from "../commands/utils/tempfile";
import { longRunning } from "../commands/utils/host";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { getPortalResourceUrl } from "../commands/utils/env";


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
                type: "string"
            },
            willHandleUserResponse: false
        },
    ]
};

async function handleDeployment(agentRequest: AgentRequest): Promise<LocalPluginResult> {
    agentRequest.responseStream.progress("Invoking AKS extension ...");

    if (agentRequest.token.isCancellationRequested) {
        return {status: "cancelled"};
    }

    //Select subscription
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return {status: "error", message: sessionProvider.error};
    }

    const allSubscriptions = await getSubscriptions(sessionProvider.result, SelectionType.All);
    if (failed(allSubscriptions)) {
        vscode.window.showErrorMessage(allSubscriptions.error);
        return {status: "error", message: allSubscriptions.error};
    }

    if (allSubscriptions.result.length === 0) {
        const noSubscriptionsFound = "No subscriptions were found. Set up your account if you have yet to do so.";
        const setupAccount = "Set up Account";
        const response = await vscode.window.showInformationMessage(noSubscriptionsFound, setupAccount);
        if (response === setupAccount) {
            vscode.env.openExternal(vscode.Uri.parse("https://azure.microsoft.com/"));
        }

        return {status: "error", message: noSubscriptionsFound};
    }
    const session = await sessionProvider.result.getAuthSession();
    if (failed(session)) {
        vscode.window.showErrorMessage(session.error);
        return {status: "error", message: session.error};
    }

    const filteredSubscriptions: SubscriptionFilter[] = await allSubscriptions.result.filter(
        (sub) => sub.tenantId === session.result.tenantId,
    ).map(sub => ({ tenantId: sub.tenantId || "", subscriptionId: sub.subscriptionId || "", label: sub.displayName || "" }));

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.result.map((sub) => {
        return {
            label: sub.displayName || "",
            description: sub.subscriptionId,
            picked: filteredSubscriptions.some(filteredSub => filteredSub.subscriptionId === sub.subscriptionId), // Set to true if the subscription is in filteredSubscriptions,
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
        return {status: "cancelled"};
    }

    //Select cluster
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
    const clusterItems : any[] = (clusterResources as unknown as Succeeded<DefinedResourceWithGroup[]>).result.map((cluster) => {
        return {
            label: cluster.name || "",
            description: cluster.id,
            picked: (clusterResources as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(clusterItem => clusterItem.name === cluster.name), // Set to true if the cluster is in clusterResources,
            subscription: {
                subscriptionId: selectedSubscription.subscription.subscriptionId || "",
                tenantId: cluster.identity?.tenantId || "",
            },
        };
    });

    const selectedCluster = await vscode.window.showQuickPick(clusterItems, {
        canPickMany: false,
        placeHolder: "Select AKS Cluster",
    });


    // Select manifest file
    const items: vscode.QuickPickItem[] = [];
    await vscode.workspace.findFiles("**/*.yaml", "**/node_modules/**").then(result => {
        result.forEach((fileUri) => {
            const fileName = path.basename(fileUri.fsPath);
            items.push({ label: fileName, description: fileUri.fsPath });
        });
    });

    const fileSelected = await vscode.window.showQuickPick(items.sort(), { title: "Select YAML", placeHolder: "Select manifest to deploy ..." });
    if (!fileSelected) {
        vscode.window.showErrorMessage("Error selecting file");
        return {status: "cancelled"};
    }    
    
    // Confirm deployment
    const confirmDeployment = await vscode.window.showQuickPick([{label: "Yes"}, {label: "No"}], { title: `Do you want to deploy to this cluster: ${selectedCluster.label}?`, placeHolder: "Select option ..." });
    if (confirmDeployment && confirmDeployment.label === "No") {
        vscode.window.showErrorMessage("Deployment operation cancelled");
        return {status: "cancelled"};
    }


    // start deplopyment
    vscode.window.showInformationMessage(`Deploying application to ${selectedCluster.label} ... `);

    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
    }

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return {status: "error", message: "Kubectl is unavailable."};
    }

    const client = getAksClient(sessionProvider.result, selectedSubscription.subscription.subscriptionId);

    let managedCluster = undefined;
    try {
        managedCluster = await client.managedClusters.get(parseResource(selectedCluster.description).resourceGroupName!, selectedCluster.label) as DefinedManagedCluster;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }  catch (e: any) {
        vscode.window.showErrorMessage(e.message);
    }

    if (!managedCluster) {
        vscode.window.showErrorMessage(`Failed to get managed cluster: ${selectedCluster.label}`);
        return {status: "error", message: `Failed to get managed cluster: ${selectedCluster.label}`};
    }
    
    // Get KubeConfig file
    const kubeconfigYaml = await getKubeconfigYaml(sessionProvider.result, selectedSubscription.subscription.subscriptionId, parseResource(selectedCluster.description).resourceGroupName!, managedCluster!);
    if (failed(kubeconfigYaml)) {
        return {status: "error", message: kubeconfigYaml.error};
    }

    const kubeConfigFile = await tmpfile.createTempFile(kubeconfigYaml.result, "yaml");
    
    //Deploy app using kubectl
    const result = await longRunning(
        `Deploying application to cluster ${selectedCluster.label}.`,
        async () => {
            return await invokeKubectlCommand(
                kubectl,
                kubeConfigFile.filePath,
                `apply -f ${fileSelected.description}`,
            );
        },
    );

    if (failed(result)) {
        vscode.window.showErrorMessage(`Failed to deploy application to the cluster: ${result.error}`);
        return {status: "error", message: result.error};
    }

    const resourceUrl = getPortalResourceUrl(getEnvironment(), managedCluster.id);

    return {
        result: "success",
        message: `Successfully deployed application to the cluster. To view status of the resource, click [here](${resourceUrl}).`,
    }
}


const deployAppToAKSPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs<typeof deployAppToAKSFunctionName, Parameters>) => {
        const pluginRequest = args.localPluginRequest;

        if (pluginRequest.functionName === deployAppToAKSFunctionName) {
            return await handleDeployment(args.agentRequest);
        }

        return {
            status: "error",
            message: "Unrecognized command."
        };
    },
}

export const deployAppToAKSPlugin: LocalPluginEntry = {
    manifest: deployAppToAKSPluginManifest,
    handler: deployAppToAKSPluginHandler,
};