import * as k8s from 'vscode-kubernetes-tools-api';
import * as vscode from 'vscode';

export async function AzureServiceBrowser(explorer: k8s.ClusterExplorerV1): Promise<k8s.ClusterExplorerV1.NodeContributor> {
    const allKinds = await allServiceKinds();
    const allFolderChildren = allKinds!.map((k) => explorer.nodeSources.resourceFolder(k.displayName, k.displayName, k.manifestKind, k.abbreviation));

    const servicesFolder = explorer.nodeSources.groupingFolder("Azure Services", undefined, ...allFolderChildren);
    return servicesFolder.at(undefined);
}

export interface AzureServiceKind {
    readonly displayName: string;
    readonly manifestKind: string;
    readonly abbreviation: string;
}

async function allServiceKinds(): Promise<AzureServiceKind[] | undefined> {
    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }
    const srASOAPIResourceCommand = await kubectl.api.invokeCommand("api-resources --api-group azure.microsoft.com --no-headers");
    if (!srASOAPIResourceCommand || srASOAPIResourceCommand.code !== 0) {
        vscode.window.showWarningMessage(`Azure Service Operator api-resources command failed with following error: ${srASOAPIResourceCommand?.stderr}.`);
        return undefined;
    }

    const treeResourceItems = srASOAPIResourceCommand.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return treeResourceItems.map((l) => parseServiceResource(l));
}

function parseServiceResource(text: string): AzureServiceKind {
    const bits = text.split(' ').filter((s) => s.length > 0);
    if (bits.length === 4) {
        // name, apigroup, namespaced, kind
        return { displayName: bits[3], manifestKind: bits[3], abbreviation: bits[0] };
    } else if (bits.length === 5) {
        // name, shortnames, apigroup, namespaced, kind
        return { displayName: bits[4], manifestKind: bits[4], abbreviation: bits[0] };
    } else {
        return { displayName: "WAT " + text, manifestKind: "WAT", abbreviation: "wat" };
    }
}
