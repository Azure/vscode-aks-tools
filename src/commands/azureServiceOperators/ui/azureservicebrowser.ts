import * as k8s from 'vscode-kubernetes-tools-api';
import * as vscode from 'vscode';

interface AzureServiceKind {
    readonly displayName: string;
    readonly manifestKind: string;
    readonly abbreviation: string;
}

export async function AzureServiceBrowser(explorer: k8s.ClusterExplorerV1): Promise<k8s.ClusterExplorerV1.NodeContributor> {
    const allKinds = await allServiceKinds();

    const allFolderChildren = allKinds?.map((k) => explorer.nodeSources.resourceFolder(k.displayName, k.displayName, k.manifestKind, k.abbreviation));
    const servicesFolder = explorer.nodeSources.groupingFolder("Azure Services", undefined, ...allFolderChildren?? []);
    return servicesFolder.at(undefined);
}

async function allServiceKinds(): Promise<AzureServiceKind[] | undefined> {
    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }
    const asoAPIResourceCommandResult = await kubectl.api.invokeCommand("api-resources --api-group azure.microsoft.com --no-headers");

    if (!asoAPIResourceCommandResult) { // Fail to invoke command
        vscode.window.showWarningMessage(`Azure Service Operator api-resources failed to invoke command.`);
        return undefined;
    } else if (asoAPIResourceCommandResult.code !== 0 && !asoAPIResourceCommandResult.stdout) { // Error result and Faild execution.
        vscode.window.showWarningMessage(`Azure Service Operator api-resources command failed with following error: ${asoAPIResourceCommandResult?.stderr}.`);
        return undefined;
    } else if (asoAPIResourceCommandResult.code === 0 && !asoAPIResourceCommandResult.stdout) { // No ASO installed.
        return undefined;
    } else {
        const treeResourceItems = asoAPIResourceCommandResult.stdout.split("\n").map((line: string) => line.trim()).filter((line: string | any[]) => line.length > 0);
        return treeResourceItems.map((item: string) => parseServiceResource(item)!);
    }
}

function parseServiceResource(apiResourceLineItem: string): AzureServiceKind | undefined {
    const apiResource = apiResourceLineItem.split(' ').filter((s) => s.length > 0);
    if (apiResource.length === 4) {
        // name, apigroup, namespaced, kind
        return { displayName: apiResource[3], manifestKind: apiResource[3], abbreviation: apiResource[0] };
    } else if (apiResource.length === 5) {
        // name, shortnames, apigroup, namespaced, kind
        return { displayName: apiResource[4], manifestKind: apiResource[4], abbreviation: apiResource[0] };
    } else {
        vscode.window.showWarningMessage(`Invalid api-resource output from azure service operator.`);
        return undefined;
    }
}