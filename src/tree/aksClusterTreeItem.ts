import { AzExtParentTreeItem, AzureTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { SubscriptionModels } from '@azure/arm-subscriptions';
import { toSubscription } from "../azure-api-utils";
import { Resource } from "@azure/arm-resources/esm/models";
import { assetUri } from "../assets";

// The de facto API of tree nodes that represent individual AKS clusters.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface AksClusterTreeNode {
    readonly nodeType: 'cluster';
    readonly armId: string;
    readonly name: string;
    readonly session: ISubscriptionContext;
    readonly subscription: SubscriptionModels.Subscription;
}

export default class AksClusterTreeItem extends AzureTreeItem implements AksClusterTreeNode {
    constructor(
        parent: AzExtParentTreeItem,
        private readonly resource: Resource) {
        super(parent);

        this.iconPath = assetUri("resources/aks-tools.png");
        this.id = this.resource.id;
    }

    public readonly contextValue: string = `aks.cluster ${CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`;

    public get label(): string {
        return this.name;
    }

    public get armId(): string {
        return this.fullId;
    }

    public get name(): string {
        return this.resource.name!;
    }

    public get resourceType(): string {
        return this.resource.type!;
    }

    public get session(): ISubscriptionContext {
        return this.root;
    }

    public get subscription(): SubscriptionModels.Subscription {
        return toSubscription(this.root);
    }

    public readonly nodeType = 'cluster';
}
