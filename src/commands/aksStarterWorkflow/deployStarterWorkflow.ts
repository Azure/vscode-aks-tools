import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import path = require('path');
import { getExtensionPath } from '../utils/host';
import * as fs from 'fs';
const tmp = require('tmp');

export default async function deployStarterWorkflow(
    context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return undefined;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return undefined;
    }

    const clusterTarget = cloudExplorer.api.resolveCommandTarget(target);

    if (clusterTarget && clusterTarget.cloudName === "Azure" &&
        clusterTarget.nodeType === "resource" && clusterTarget.cloudResource.nodeType === "cluster" &&
        clusterExplorer.available) {

        const aksCluster = clusterTarget.cloudResource as AksClusterTreeItem;
        // vscode.window.showTextDocument()
        const extensionPath = getExtensionPath();

        const pos1 = new vscode.Position(10, 4);
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'azure-kubernetes-service.yml'));
        const openPath = vscode.Uri.file(yamlPathOnDisk.fsPath);

        const replacedDoc = fs.readFileSync(openPath.fsPath, 'utf8')
                                .replace('<RESOURCE_GROUP>', clusterTarget.cloudResource.armId.split("/")[4])
                                .replace('<CLUSTER_NAME>', aksCluster.name);

        const templateYaml = tmp.fileSync({ prefix: "azure-kubernetes-service", postfix: `.yaml` });
        fs.writeFileSync(templateYaml.name, replacedDoc);

        const tmpFilePathOnDisk = vscode.Uri.file(path.join(templateYaml.name));
        const openPath2 = vscode.Uri.file(tmpFilePathOnDisk.fsPath);

        vscode.workspace.openTextDocument(openPath2).then((doc) =>
        {
            vscode.window.showTextDocument(doc).then((editor) =>
            {
                // Line added - by having a selection at the same position twice, the cursor jumps there
                editor.selections = [new vscode.Selection(pos1, pos1)];

                // And the visible range jumps there too
                const range = new vscode.Range(pos1, pos1);
                editor.revealRange(range);
            });
        });
        vscode.window.showInformationMessage(`The AKS clusters ${aksCluster.name} was clicked.`);

        // await install(kubectl.api, aksCluster);
        clusterExplorer.api.refresh();
    } else {
        vscode.window.showInformationMessage('This command only applies to AKS clusters.');
    }
}
