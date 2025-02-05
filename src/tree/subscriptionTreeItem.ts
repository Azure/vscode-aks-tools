import {
    AzExtParentTreeItem,
    AzExtTreeDataProvider,
    AzExtTreeItem,
    ISubscriptionContext,
} from "@microsoft/vscode-azext-utils";
import { createClusterTreeNode } from "./aksClusterTreeItem";
import { createFleetTreeNode, FleetTreeNode } from "./fleetTreeItem";
import { assetUri } from "../assets";
import * as k8s from "vscode-kubernetes-tools-api";
import { window } from "vscode";
import {
    clusterResourceType,
    fleetResourceType,
    getResources,
    getFleetMembers,
    DefinedResourceWithGroup,
    DefinedFleetMemberWithGroup,
} from "../commands/utils/azureResources";
import { failed } from "../commands/utils/errorable";
import { ReadyAzureSessionProvider } from "../auth/types";

// The de facto API of tree nodes that represent individual Azure subscriptions.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface SubscriptionTreeNode {
    readonly nodeType: "subscription";
    readonly name: string;
    readonly subscriptionId: string;
    readonly treeDataProvider: AzExtTreeDataProvider;
    readonly treeItem: AzExtTreeItem;
}

export function isSubscriptionTreeNode(node: unknown): node is SubscriptionTreeNode {
    return node instanceof SubscriptionTreeItem;
}

export function createSubscriptionTreeItem( // create subscription node
    parent: AzExtParentTreeItem,
    sessionProvider: ReadyAzureSessionProvider,
    subscription: ISubscriptionContext,
): AzExtTreeItem {
    return new SubscriptionTreeItem(parent, sessionProvider, subscription);
}

class SubscriptionTreeItem extends AzExtParentTreeItem implements SubscriptionTreeNode {
    private readonly sessionProvider: ReadyAzureSessionProvider;
    public readonly subscriptionContext: ISubscriptionContext;
    public readonly subscriptionId: string;
    public readonly name: string;
    public readonly contextValue = "aks.subscription";
    public readonly label: string;

    public constructor(
        parent: AzExtParentTreeItem,
        sessionProvider: ReadyAzureSessionProvider,
        subscription: ISubscriptionContext,
    ) {
        super(parent);
        this.sessionProvider = sessionProvider;
        this.subscriptionContext = subscription;
        this.subscriptionId = subscription.subscriptionId;
        this.name = subscription.subscriptionDisplayName;
        this.label = subscription.subscriptionDisplayName;
        this.id = subscription.subscriptionPath;
        this.iconPath = assetUri("resources/azureSubscription.svg");
    }

    get treeItem(): AzExtTreeItem {
        return this;
    }

    /**
     * Needed by parent class.
     */
    get subscription(): ISubscriptionContext {
        return this.subscriptionContext;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    async fetchClustersAndFleets() {
        const clusterResourcesPromise = await getResources(
            this.sessionProvider,
            this.subscriptionId,
            clusterResourceType,
        );
        if (failed(clusterResourcesPromise)) {
            window.showErrorMessage(
                `Failed to list clusters in subscription ${this.subscriptionId}: ${clusterResourcesPromise.error}`,
            );
            throw clusterResourcesPromise.error;
        }

        const fleetResourcesPromise = await getResources(this.sessionProvider, this.subscriptionId, fleetResourceType);
        if (failed(fleetResourcesPromise)) {
            window.showErrorMessage(
                `Failed to list fleets in subscription ${this.subscriptionId}: ${fleetResourcesPromise.error}`,
            );
            throw fleetResourcesPromise.error;
        }

        return { clusterResources: clusterResourcesPromise.result, fleetResources: fleetResourcesPromise.result };
    }

    private async mapFleetAndClusterMembers(fleetResources: DefinedResourceWithGroup[]) {
        const fleetToMembersMap = new Map<string, DefinedFleetMemberWithGroup[]>();
        const clusterToMemberMap = new Map<string, DefinedFleetMemberWithGroup>();

        const memberPromises = fleetResources.map(async (f) => {
            const members = await getFleetMembers(this.sessionProvider, f);
            if (failed(members)) {
                window.showErrorMessage(
                    `Failed to list fleets in subscription ${this.subscriptionId}: ${members.error}`,
                );
                return null;
            }
            fleetToMembersMap.set(f.id, members.result); // key - fleet.id, val: fleet.memberClusters list
            return members.result;
        });
        await Promise.all(memberPromises); // wait for all members to be fetched

        fleetToMembersMap.forEach((members) => {
            members.forEach((member) => {
                clusterToMemberMap.set(member.clusterResourceId.toLowerCase(), member);
            });
        });

        return { fleetToMembersMap, clusterToMemberMap };
    }

    public async loadMoreChildrenImpl(): Promise<AzExtTreeItem[]> {
        let clusterResources: DefinedResourceWithGroup[] = [];
        let fleetResources: DefinedResourceWithGroup[] = [];
        ({ clusterResources, fleetResources } = await this.fetchClustersAndFleets());
        const { fleetToMembersMap, clusterToMemberMap } = await this.mapFleetAndClusterMembers(fleetResources);

        // remove clusters that are members of fleets
        clusterResources = clusterResources.filter((r) => !clusterToMemberMap.has(r.id.toLowerCase()));

        const fleetTreeNodes = new Map<string, FleetTreeNode>();
        const clusterTreeItems = new Map<string, AzExtTreeItem>();
        fleetResources.concat(clusterResources).forEach((r) => {
            if (r.type?.toLocaleLowerCase() === "microsoft.containerservice/fleets") {
                const fleetTreeItem = createFleetTreeNode(this, this.subscriptionId, r);
                fleetTreeItem.addCluster(fleetToMembersMap.get(r.id) || []);
                fleetTreeNodes.set(r.id, fleetTreeItem);
                return fleetTreeItem;
            } else if (r.type?.toLocaleLowerCase() === "microsoft.containerservice/managedclusters") {
                const cluster = createClusterTreeNode(this, this.subscriptionId, r);
                clusterTreeItems.set(r.id, cluster);
                return clusterTreeItems;
            } else {
                window.showErrorMessage(`unexpected type ${r.type} in resources list`);
            }
            return [];
        });
        // cast via unknown because I know it's ok.
        // probably me making a mess with types. fix later.
        const fleetTreeItems = Array.from(fleetTreeNodes.values()).map((f) => f as unknown as AzExtTreeItem);
        return Promise.resolve([...fleetTreeItems.values(), ...clusterTreeItems.values()]);
    }

    public async refreshImpl(): Promise<void> {
        // NOTE: Cloud Explorer wraps this node with its own and doesn't listen for change events.
        //       Hence, we must force Cloud Explorer to refresh in addition to reloading this node.
        const cloudExplorer = await k8s.extension.cloudExplorer.v1;
        if (cloudExplorer.available) {
            cloudExplorer.api.refresh();
        }
    }

    public readonly nodeType = "subscription";
}
