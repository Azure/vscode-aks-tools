import { GenericResource } from 'azure-arm-resource/lib/resource/models';
import { CloudExplorerV1 } from 'vscode-kubernetes-tools-api';

export class aksCluster implements GenericResource {
    id: string;
    type: any;
    subscriptionId: any;
    public constructor(node: CloudExplorerV1.CloudExplorerResourceNode) {
        this.id = node.cloudResource.id;
        this.type = 'cluster';
        this.subscriptionId = node.cloudResource.subscription.subscriptionId;
    }
}