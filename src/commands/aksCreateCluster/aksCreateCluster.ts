import { QuickPickItem } from 'vscode';
import { MultiStepInput } from '../../multistep-helper/multistep-helper';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem, getContainerClientFromSubTreeNode, getResourceGroupList } from '../utils/clusters';
import { failed } from '../utils/errorable';
import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import SubscriptionTreeItem from '../../tree/subscriptionTreeItem';
import { ResourceIdentityType } from '@azure/arm-containerservice';
import { longRunning } from '../utils/host';
import { ResourceGroupsListNextResponse } from '@azure/arm-resources/esm/models';


interface State {
    title: string;
    step: number;
    totalSteps: number;
    resourceGroup: QuickPickItem;
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
            totalSteps: 2,
            value: state.clustername || '',
            prompt: 'Choose a unique name for the AKS cluster \n (Valid cluster name is 1 to 63 in length consist of letters, numbers, dash and underscore)',
            validate: validateAKSClusterName,
            shouldResume: shouldResume
        });

        return (input: MultiStepInput) => pickResourceGroup(input, state);
    }

    const resourceList = await getResourceGroupList(<SubscriptionTreeItem> cluster.result);
    if (!resourceList.succeeded) {
        return
    }
    const resourceNameGroupList = getResourceNameGroupList(resourceList.result);
    const resourceGroups: QuickPickItem[] = resourceNameGroupList.map(label => ({ label }));

    async function pickResourceGroup(input: MultiStepInput, state: Partial<State>) {
        const pick = await input.showQuickPick({
            title,
            step: 2,
            totalSteps: 2,
            placeholder: 'Pick a resource group',
            items: resourceGroups,
            activeItem: typeof state.resourceGroup !== 'string' ? state.resourceGroup : undefined,
            shouldResume: shouldResume
        });

        state.resourceGroup = pick;
    }


    function shouldResume() {
        // Could show a notification with the option to resume.
        return new Promise<boolean>((resolve, reject) => {
            // noop
        });
    }

    async function validateAKSClusterName(name: string) {
        // ...validate...
        await new Promise(resolve => setTimeout(resolve, 1000));
        const regexp = new RegExp(/^([a-zA-Z0-9_-]){1,63}$/);
        return !regexp.test(name) ? 'Invalid AKS Cluster Name' : undefined;;
    }

    const state = await collectInputs();
    state.subid = cluster.result.subscription.subscriptionId;

    // Call create cluster at this instance
    createManagedClusterWithOssku(state, <SubscriptionTreeItem> cluster.result);
}

function getResourceNameGroupList(resourceList: ResourceGroupsListNextResponse) {
    var resourceLocationDictionary = [];
    
    for (const group of resourceList) {
        if (group.name?.startsWith("MC_")) continue;
        resourceLocationDictionary.push(`${group.name!} (${group.location})`);
    }

    return resourceLocationDictionary;
}

/**
 * This sample demonstrates how to Creates or updates a managed cluster.
 *
 * @summary Creates or updates a managed cluster.
 * x-ms-original-file: specification/containerservice/resource-manager/Microsoft.ContainerService/aks/stable/2023-04-01/examples/ManagedClustersCreate_OSSKU.json
 */
async function createManagedClusterWithOssku(state: State, subTreeNode: SubscriptionTreeItem) {
    const resourceGroupName = state.resourceGroup.label.toString().split(' ')[0];
    const clusterName = state.clustername;

    const resourceIdentityType: ResourceIdentityType = "SystemAssigned"
    const parameters = {
        addonProfiles: {},
        location: state.resourceGroup.label.toString().split(' ')[1].replace(/\(|\)/g,""),
        identity: { 
            type: resourceIdentityType 
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
    };
    const containerClient = getContainerClientFromSubTreeNode(subTreeNode);

    try {
        const result = await longRunning(`Creating cluster ${state.clustername}.`, async () => { 
            return await containerClient.managedClusters.beginCreateOrUpdateAndWait(
                resourceGroupName,
                clusterName,
                parameters
            );
        });
         
        console.log(result);
        vscode.window.showInformationMessage(`Create aks cluster ${result.provisioningState} for cluster ${result.name}`);
    } catch (e) {
         console.log(e);
         vscode.window.showErrorMessage(`Creating cluster ${clusterName} failed with following error: ${e}`)
    }
}
