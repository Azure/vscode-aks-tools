import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";

export class aksClusterNode{
    nodeType: string;
    resourceId: string;
    subscriptionId: string;

    public constructor(node: CloudExplorerV1.CloudExplorerResourceNode) {
        this.nodeType = 'cluster';
        this.resourceId = node.cloudResource.id;
        this.subscriptionId = node.cloudResource.subscription.subscriptionId;
    }
}