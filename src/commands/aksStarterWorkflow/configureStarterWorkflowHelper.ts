import path = require("path");
import * as fs from 'fs';
import { getExtensionPath } from "../utils/host";
import * as vscode from 'vscode';

export function configureStarterConfigDataForAKS(
    resourceName: string,
    clusterName: string
): string {
    const extensionPath = getExtensionPath();

    // Load vscode resoruce yaml file and replace content.
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'azure-kubernetes-service.yml'));
    const starterFileAutoFillContent = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8')
                                            .replace('<RESOURCE_GROUP>', resourceName)
                                            .replace('<CLUSTER_NAME>', clusterName);

    return starterFileAutoFillContent;
}
