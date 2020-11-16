import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';

export default async function unpinned(
    context: IActionContext,
    target: any
): Promise<void> {

    const kubectl = await k8s.extension.kubectl.v1;

    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (clusterExplorer.available && kubectl.available) {
        let unpinnedItems = <any>vscode.workspace.getConfiguration().get('aso.pinned');
        const itemToUnpin = target.impl.kind;
        unpinnedItems = unpinnedItems.filter((item: any) => item !== itemToUnpin);

        await vscode.workspace.getConfiguration().update('aso.pinned', unpinnedItems, vscode.ConfigurationTarget.Global);

        clusterExplorer.api.refresh();
    }

}