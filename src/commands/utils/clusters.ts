import * as vscode from 'vscode';
import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import { parseResource } from "../../azure-api-utils";
import * as azcs from '@azure/arm-containerservice'; // 'azure-arm-containerservice'; // deprecated, but @azure/arm-containerservice doesn't play nicely with AzureAccount, so...

export async function getKubeconfigYaml(target: AksClusterTreeItem): Promise<string | undefined> {
    const { resourceGroupName, name } = parseResource(target.id!);
    if (!resourceGroupName || !name) {
        vscode.window.showErrorMessage(`Invalid ARM id ${target.id}`);
        return undefined;
    }
    const client = new azcs.ContainerServiceClient(target.root.credentials, target.root.subscriptionId);  // TODO: safely
    try {
        const clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(resourceGroupName, name);
        const kubeconfigCredResult = clusterUserCredentials.kubeconfigs!.find((kubeInfo) => kubeInfo.name === "clusterUser");
        const kubeconfig = kubeconfigCredResult?.value?.toString();
        return kubeconfig;
    } catch (e) {
        vscode.window.showErrorMessage(`Can't get kubeconfig: ${e}`);
        return undefined;
    }
}

// function restJSCredentialsFrom(target: AksClusterTreeItem) {
//     return <msRestJs.ServiceClientCredentials><unknown>target.root.credentials;
// }