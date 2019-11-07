import { AzExtParentTreeItem, AzureTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { Resource } from "azure-arm-storage/lib/models";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { SubscriptionClient } from 'azure-arm-resource';
import { toSubscription } from "../azure-api-utils";

export default class AkClusterTreeItem extends AzureTreeItem {
    constructor(
        parent: AzExtParentTreeItem,
        private readonly resource: Resource) {
            super(parent);

            // TODO: Set fancy icon for AKS cluster nodes.

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
        return this.resource.name || '';
    }

    public get session(): ISubscriptionContext {
        return this.root;
    }

    public get subscription(): SubscriptionClient.SubscriptionModels.Subscription {
        return toSubscription(this.root);
    }

    public readonly nodeType: string = 'cluster';
}
