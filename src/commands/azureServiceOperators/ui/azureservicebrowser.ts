import * as k8s from 'vscode-kubernetes-tools-api';
import * as vscode from 'vscode';
import { Errorable } from '../../utils/errorable';

interface AzureServiceKind {
    readonly displayName: string;
    readonly manifestKind: string;
    readonly abbreviation: string;
}

enum ASOInstallation {
    ASONotInstalled = 'ASONotInstalled'
}

export async function AzureServiceBrowser(explorer: k8s.ClusterExplorerV1): Promise<k8s.ClusterExplorerV1.NodeContributor> {
    const allKinds = await allServiceKinds();

    const allFolderChildren = allKinds?.map((k) => explorer.nodeSources.resourceFolder(k.displayName, k.displayName, k.manifestKind, k.abbreviation));
    const servicesFolder = explorer.nodeSources.groupingFolder("Azure Services", undefined, ...allFolderChildren?? []);
    return servicesFolder.at(undefined);
}

async function allServiceKinds(): Promise<AzureServiceKind[] | undefined> {
    const apiResult = await getAPIResourceCommandResult();

    if (apiResult.succeeded) {
        return apiResult.result;
    }

    if (apiResult.error !== ASOInstallation.ASONotInstalled) {
        vscode.window.showWarningMessage(apiResult.error);
    }
    return undefined;
}

async function getAPIResourceCommandResult(): Promise<Errorable<AzureServiceKind[]>> {
    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        return { succeeded: false, error: `Kubectl is unavailable.` };
    }
    const asoAPIResourceCommandResult = await kubectl.api.invokeCommand("get crds -o='custom-columns=Name:.metadata.name'");

    if (!asoAPIResourceCommandResult) { // Fail to invoke command.
        return { succeeded: false, error: `Azure Service Operator api-resources failed to invoke command.` };
    } else if (asoAPIResourceCommandResult.stdout) { // kubectl returned a list of resources (even if it errored part way through)
        const treeResourceItems = asoAPIResourceCommandResult.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && line.includes("azure.com"));
        return { succeeded: true, result: treeResourceItems.map((item: string) => parseServiceResource(item)!) };
    } else if (asoAPIResourceCommandResult.code === 0) { // ASO is not installed.
        return { succeeded: false, error: ASOInstallation.ASONotInstalled };
    } else {
        return { succeeded: false, error: `Azure Service Operator api-resources command failed with following error: ${asoAPIResourceCommandResult?.stderr}.` };
    }
}

function parseServiceResource(apiResourceLineItem: string): AzureServiceKind | undefined {
    const apiResource = apiResourceLineItem.split('.').filter((s) => s.length > 0);
    if (apiResource.length === 4) {
        // name, apigroup, namespaced, kind
        return { displayName: apiResource[0], manifestKind: apiResource[1], abbreviation: apiResource[0] };
    } else {
        vscode.window.showWarningMessage(`Invalid api-resource output from azure service operator.`);
        return undefined;
    }
}
