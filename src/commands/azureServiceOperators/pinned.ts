import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';

export default async function pinned(
    context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;

    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (clusterExplorer.available && kubectl.available) {
        let pinnedItems = <any>vscode.workspace.getConfiguration().get('aso.pinned');
        const itemPinned = target.impl.kind;
        pinnedItems = pinnedItems.filter((item: any) => item.displayName !== itemPinned.displayName);

        pinnedItems.push(itemPinned);
        await vscode.workspace.getConfiguration().update('aso.pinned', pinnedItems, vscode.ConfigurationTarget.Global);

        clusterExplorer.api.refresh();
    }
}
