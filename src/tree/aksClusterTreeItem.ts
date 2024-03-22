import { AzExtParentTreeItem, AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { assetUri } from "../assets";
import { parseResource } from "../azure-api-utils";
import { DefinedManagedCluster } from "../commands/utils/clusters";
import { SubscriptionTreeNode } from "./subscriptionTreeItem";

// The de facto API of tree nodes that represent individual AKS clusters.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface AksClusterTreeNode {
    readonly nodeType: "cluster";
    readonly resourceType: string;
    readonly armId: string;
    readonly name: string;
    readonly subscriptionTreeNode: SubscriptionTreeNode;
    readonly subscriptionId: string;
    readonly resourceGroupName: string;
}

export function createClusterTreeNode(
    parent: AzExtParentTreeItem & SubscriptionTreeNode,
    subscriptionId: string,
    cluster: DefinedManagedCluster,
): AzExtTreeItem {
    return new AksClusterTreeItem(parent, subscriptionId, cluster);
}

class AksClusterTreeItem extends AzExtTreeItem implements AksClusterTreeNode {
    public readonly subscriptionTreeNode: SubscriptionTreeNode;
    public readonly armId: string;
    public readonly resourceGroupName: string;
    public readonly name: string;

    constructor(
        parent: AzExtParentTreeItem & SubscriptionTreeNode,
        readonly subscriptionId: string,
        readonly cluster: DefinedManagedCluster,
    ) {
        super(parent);

        this.iconPath = assetUri("resources/aks-tools.png");
        this.subscriptionTreeNode = parent;
        // cluster.id is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
        const { resourceGroupName } = parseResource(cluster.id);
        this.id = `${this.cluster.name} ${resourceGroupName!}`;
        this.armId = this.cluster.id;
        this.resourceGroupName = resourceGroupName!;
        this.name = this.cluster.name;
    }

    public readonly contextValue: string = `aks.cluster ${CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`;

    public get label(): string {
        return this.name;
    }

    public get resourceType(): string {
        return "Microsoft.ContainerService/managedClusters";
    }

    public get clusterTreeItem(): AzExtTreeItem {
        return this;
    }

    public readonly nodeType = "cluster";
}
