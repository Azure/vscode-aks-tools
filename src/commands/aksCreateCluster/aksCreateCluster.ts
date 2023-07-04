import { QuickPickItem, window, CancellationToken, QuickInputButton, Uri } from 'vscode';
import { MultiStepInput } from '../../multistep-helper/multistep-helper';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem, getContainerClientFromSubTreeNode } from '../utils/clusters';
import { failed } from '../utils/errorable';
import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import SubscriptionTreeItem from '../../tree/subscriptionTreeItem';
import { ResourceIdentityType } from '@azure/arm-containerservice';

interface State {
    title: string;
    step: number;
    totalSteps: number;
    resourceGroup: QuickPickItem | string;
    name: string;
    clustername: string;
    subid: string | undefined;
    runtime: QuickPickItem;
}

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 * 
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateCluster(
    context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterSubscriptionItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    class MyButton implements QuickInputButton {
        constructor(public iconPath: { light: Uri; dark: Uri; }, public tooltip: string) { }
    }

    // const createResourceGroupButton = new MyButton({
    //     dark: Uri.file(context.asAbsolutePath('resources/dark/add.svg')),
    //     light: Uri.file(context.asAbsolutePath('resources/light/add.svg')),
    // }, 'Create Resource Group');

    const resourceGroups: QuickPickItem[] = ['vscode-data-function', 'vscode-appservice-microservices', 'vscode-appservice-monitor', 'vscode-appservice-preview', 'vscode-appservice-prod']
        .map(label => ({ label }));

    async function collectInputs() {
        const state = {} as Partial<State>;
        await MultiStepInput.run(input => inputClusterName(input, state));
        return state as State;
    }

    const title = 'Create AKS Cluster';

    async function inputClusterName(input: MultiStepInput, state: Partial<State>) {
        state.clustername = await input.showInputBox({
            title,
            step: 1,
            totalSteps: 5,
            value: state.clustername || '',
            prompt: 'Choose a unique name for the AKS cluster \n (Valid cluster name is 1 to 63 in length consist of letters, numbers, dash and underscore)',
            validate: validateAKSClusterName,
            shouldResume: shouldResume
        });

        return (input: MultiStepInput) => pickResourceGroup(input, state);
    }

    async function pickResourceGroup(input: MultiStepInput, state: Partial<State>) {
        const pick = await input.showQuickPick({
            title,
            step: 2,
            totalSteps: 5,
            placeholder: 'Pick a resource group',
            items: resourceGroups,
            activeItem: typeof state.resourceGroup !== 'string' ? state.resourceGroup : undefined,
            // buttons: [createResourceGroupButton],
            shouldResume: shouldResume
        });
        if (pick instanceof MyButton) {
            return (input: MultiStepInput) => inputResourceGroupName(input, state);
        }
        state.resourceGroup = pick;
        return (input: MultiStepInput) => inputName(input, state);
    }

    async function inputResourceGroupName(input: MultiStepInput, state: Partial<State>) {
        state.resourceGroup = await input.showInputBox({
            title,
            step: 3,
            totalSteps: 5,
            value: typeof state.resourceGroup === 'string' ? state.resourceGroup : '',
            prompt: 'Choose a unique name for the resource group',
            validate: validateNameIsUnique,
            shouldResume: shouldResume
        });
        return (input: MultiStepInput) => inputName(input, state);
    }

    async function inputName(input: MultiStepInput, state: Partial<State>) {
        const additionalSteps = typeof state.resourceGroup === 'string' ? 1 : 0;
        // TODO: Remember current value when navigating back.
        state.name = await input.showInputBox({
            title,
            step: 3 + additionalSteps,
            totalSteps: 4 + additionalSteps,
            value: state.name || '',
            prompt: 'Choose a unique name for the Application Service',
            validate: validateNameIsUnique,
            shouldResume: shouldResume
        });
        return (input: MultiStepInput) => pickRuntime(input, state);
    }

    async function pickRuntime(input: MultiStepInput, state: Partial<State>) {
        const additionalSteps = typeof state.resourceGroup === 'string' ? 1 : 0;
        const runtimes = await getAvailableRuntimes(state.resourceGroup!, undefined /* TODO: token */);
        // TODO: Remember currently active item when navigating back.
        state.runtime = await input.showQuickPick({
            title,
            step: 3 + additionalSteps,
            totalSteps: 3 + additionalSteps,
            placeholder: 'Pick a runtime',
            items: runtimes,
            activeItem: state.runtime,
            shouldResume: shouldResume
        });
    }

    function shouldResume() {
        // Could show a notification with the option to resume.
        return new Promise<boolean>((resolve, reject) => {
            // noop
        });
    }

    async function validateNameIsUnique(name: string) {
        // ...validate...
        await new Promise(resolve => setTimeout(resolve, 1000));
        return name === 'vscode' ? 'Name not unique' : undefined;
    }

    async function validateAKSClusterName(name: string) {
        // ...validate...
        await new Promise(resolve => setTimeout(resolve, 1000));
        const regexp = new RegExp(/^([a-zA-Z0-9_-]){1,63}$/);
        return !regexp.test(name) ? 'Invalid AKS Cluster Name' : undefined;;
    }

    async function getAvailableRuntimes(resourceGroup: QuickPickItem | string, token?: CancellationToken): Promise<QuickPickItem[]> {
        // ...retrieve...
        await new Promise(resolve => setTimeout(resolve, 1000));
        return ['Node 8.9', 'Node 6.11', 'Node 4.5']
            .map(label => ({ label }));
    }

    const state = await collectInputs();
    state.subid = cluster.result.subscription.subscriptionId;
    window.showInformationMessage(`Creating Application Service '${state.name}'`);
    // Call create cluster at this instance
    createManagedClusterWithOssku(state, <SubscriptionTreeItem> cluster.result);
}

/**
 * This sample demonstrates how to Creates or updates a managed cluster.
 *
 * @summary Creates or updates a managed cluster.
 * x-ms-original-file: specification/containerservice/resource-manager/Microsoft.ContainerService/aks/stable/2023-04-01/examples/ManagedClustersCreate_OSSKU.json
 */
async function createManagedClusterWithOssku(state: State, subTreeNode: SubscriptionTreeItem) {
    // const subscriptionId = state.subid;
    const resourceGroupName = process.env["CONTAINERSERVICE_RESOURCE_GROUP"] || "tats_aso";
    const resourceName = state.clustername; // "clustername1";
    console.log(state);
    const foo: ResourceIdentityType = "SystemAssigned"
    const parameters = {
        addonProfiles: {},
        location: "eastus2",
        identity: { 
            type: foo 
        },
        agentPoolProfiles: [
            {
                name: "nodepool1",
                type: "VirtualMachineScaleSets",
                count: 3,
                enableNodePublicIP: true,
                mode: "System",
                osSKU: "AzureLinux",
                osType: "Linux",
                vmSize: "Standard_DS2_v2"
            },
        ],
        dnsPrefix : `${state.clustername}-dns`
        // autoScalerProfile: { scaleDownDelayAfterAdd: "15m", scanInterval: "20s" },
        // diskEncryptionSetID:
        //     `/subscriptions/${subTreeNode.subscription.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/diskEncryptionSets/des`,
        //     // dnsPrefix: "dnsprefix1",
        //     enablePodSecurityPolicy: false,
        //     kubernetesVersion: "",
        //     location: "eastus2",
        //     // networkProfile: {
        //     //   loadBalancerProfile: { managedOutboundIPs: { count: 2 } },
        //     //   loadBalancerSku: "standard",
        //     //   outboundType: "loadBalancer",
        //     // },
        //     // servicePrincipalProfile: { clientId: "df88d5f7-657f-45c0-a5ea-986db77a7d4c", secret: "azh8Q~aiPiSh1MH1v76F~PvOimnd8tt-oGQ4gcyY" },
        //     sku: { name: "Basic", tier: "Free" },
        //     tags: { archv2: "", tier: "dev/test" }
    };
    // const credential = new DefaultAzureCredential();
    const containerClient = getContainerClientFromSubTreeNode(subTreeNode);

   //  const client = new ContainerServiceClient(credential, subscriptionId);
    try {
        const result = await containerClient.managedClusters.beginCreateOrUpdateAndWait(
            resourceGroupName,
            resourceName,
            parameters
        );
        console.log(result);

    } catch (e) {
         console.log(e);
    }
    vscode.window.showInformationMessage('Yay we are done!!!');
}
