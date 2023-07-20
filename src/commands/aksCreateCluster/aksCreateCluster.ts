import { QuickPickItem } from 'vscode';
import { createInputBoxStep, createQuickPickStep, runMultiStepInput } from '../../multistep-helper/multistep-helper';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem, getContainerClientFromSubTreeNode, getResourceGroupList } from '../utils/clusters';
import { Errorable, failed } from '../utils/errorable';
import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import SubscriptionTreeItem from '../../tree/subscriptionTreeItem';
import { ResourceIdentityType } from '@azure/arm-containerservice';
import { longRunning } from '../utils/host';
import { ResourceGroup } from '@azure/arm-resources/esm/models';
const meta = require('../../../package.json');

interface State {
    resourceGroup: ResourceGroupItem;
    clustername: string;
    subid: string | undefined;
}

interface ResourceGroupItem extends QuickPickItem {
    name: string;
    location: string;
}

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 * 
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateCluster(
    _context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterSubscriptionItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    const resourceList = await getResourceGroupList(<SubscriptionTreeItem>cluster.result);
    if (!resourceList.succeeded) {
        vscode.window.showErrorMessage(resourceList.error);
        return
    }

    const resourceGroups = resourceList.result.filter(isValidResourceGroup).map<ResourceGroupItem>(g => ({
        label: `${g.name!} (${g.location})`,
        name: g.name!,
        location: g.location
    })).sort((a, b) => a.name > b.name ? 1 : -1);

    const clusterNameStep = createInputBoxStep<State>({
        shouldResume: () => Promise.resolve(false),
        getValue: state => state.clustername || '',
        prompt: 'Choose a unique name for the AKS cluster \n (Valid cluster name is 1 to 63 in length consist of letters, numbers, dash and underscore)',
        validate: validateAKSClusterName,
        storeValue: (state, value) => ({...state, clustername: value})
    });

    const resourceGroupStep = createQuickPickStep<State, ResourceGroupItem>({
        placeholder: 'Pick a resource group',
        shouldResume: () => Promise.resolve(false),
        items: resourceGroups,
        getActiveItem: state => state.resourceGroup,
        storeItem: (state, item) => ({...state, resourceGroup: item})
    });

    const initialState: Partial<State> = {
        subid: cluster.result.subscription.subscriptionId
    };

    const state = await runMultiStepInput('Create AKS Cluster', initialState, clusterNameStep, resourceGroupStep);
    if (!state) {
        // Cancelled
        return;
    }

    // Call create cluster at this instance
    createManagedClusterWithOssku(state, <SubscriptionTreeItem>cluster.result);
}

function isValidResourceGroup(group: ResourceGroup) {
    if (group.name?.startsWith("MC_")) {
        return false;
    }

    return true;
}

async function validateAKSClusterName(name: string): Promise<Errorable<void>> {
    const regexp = new RegExp(/^([a-zA-Z0-9_-]){1,63}$/);
    if (!regexp.test(name)) {
        return { succeeded: false, error: 'Invalid AKS Cluster Name' };
    }

    return { succeeded: true, result: undefined };
}

/**
 * This sample demonstrates how to Creates or updates a managed cluster.
 *
 * @summary Creates or updates a managed cluster.
 * x-ms-original-file: specification/containerservice/resource-manager/Microsoft.ContainerService/aks/stable/2023-04-01/examples/ManagedClustersCreate_OSSKU.json
 */
async function createManagedClusterWithOssku(state: State, subTreeNode: SubscriptionTreeItem) {
    const resourceGroupName = state.resourceGroup.name;
    const clusterName = state.clustername;

    const resourceIdentityType: ResourceIdentityType = "SystemAssigned"
    const parameters = {
        addonProfiles: {},
        location: state.resourceGroup.location,
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
        dnsPrefix: `${state.clustername}-dns`
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

        // sample armId: '/subscriptions/<sub_id>/resourceGroups/<resource_group_name>/providers/Microsoft.ContainerService/managedClusters/<cluster_name>'
        const portalUrl = subTreeNode.subscription.environment.portalUrl.replace(/\/$/, "");
        const armId = `/subscriptions/${subTreeNode.subscription.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`
        const navToPortal = "Navigate to Portal"
        vscode.window.showInformationMessage(`Create aks cluster ${result.provisioningState} for cluster ${result.name}`, navToPortal)
            .then(selection => {
                if (selection === navToPortal) {
                    vscode.env.openExternal(
                        vscode.Uri.parse(`${portalUrl}/#resource${armId}/overview?referrer_source=vscode&referrer_context=${meta.name}`)
                    );
                }
            });
    } catch (e) {
        vscode.window.showErrorMessage(`Creating cluster ${clusterName} failed with following error: ${e}`)
    }
}
