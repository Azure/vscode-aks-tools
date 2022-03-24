import path = require("path");
import * as fs from 'fs';
import { getExtensionPath } from "../utils/host";
import * as vscode from 'vscode';
import { Errorable, failed } from "../utils/errorable";

export function configureStarterConfigDataForAKS(
    resourceName: string,
    clusterName: string
): Errorable<string> {
    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        return extensionPath;
    }

      // Load vscode resoruce yaml file and replace content.
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath.result, 'resources', 'yaml', 'azure-kubernetes-service.yml'));
    const starterFileAutoFillContent = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8')
                                            .replace('<RESOURCE_GROUP>', resourceName)
                                            .replace('<CLUSTER_NAME>', clusterName);

    return { succeeded: true, result: starterFileAutoFillContent };
}
