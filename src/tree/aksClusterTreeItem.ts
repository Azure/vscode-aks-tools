import { AzExtParentTreeItem, AzureTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { Resource } from "azure-arm-storage/lib/models";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { SubscriptionClient } from 'azure-arm-resource';
import { toSubscription } from "../azure-api-utils";
import { getExtensionPath } from "../commands/utils/host";
import * as path from 'path';
import * as vscode from 'vscode';

// The de facto API of tree nodes that represent individual AKS clusters.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface AksClusterTreeNode {
    readonly nodeType: 'cluster';
    readonly armId: string;
    readonly name: string;
    readonly session: ISubscriptionContext;
    readonly subscription: SubscriptionClient.SubscriptionModels.Subscription;
}

export default class AksClusterTreeItem extends AzureTreeItem implements AksClusterTreeNode {
    constructor(
        parent: AzExtParentTreeItem,
        private readonly resource: Resource) {
        super(parent);

        // TODO: Set fancy icon for AKS cluster nodes for Google Cloud and AWS.
        // For now this carefully enables AKS Icons for Azure Clsuter.
        if (this.nodeType === "cluster" && this.root.environment.name === "Azure" && this.contextValue.includes("aks.cluster")) {
            this.iconPath = vscode.Uri.file(path.join(getExtensionPath()!, 'resources', 'k8s-logo.png'));
        }
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

    public readonly nodeType = 'cluster';
}
