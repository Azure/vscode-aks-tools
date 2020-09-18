import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";

export default async function refreshSubscriptions(context: IActionContext, target: any): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
        const commandTarget = cloudExplorer.api.resolveCommandTarget(target);

        if (commandTarget && commandTarget.nodeType === 'resource') {
            target.provider.treeDataProvider.refresh();
        }
    }
}