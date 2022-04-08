import path = require("path");
import * as fs from 'fs';
import { getExtensionPath } from "./host";
import * as vscode from 'vscode';
import { Errorable, failed } from "./errorable";

export function configureStarterConfigDataForAKS(
    resourceName: string,
    clusterName: string,
    workflowName: string
): Errorable<string> {
    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        return extensionPath;
    }

      // Load vscode resoruce yaml file and replace content.
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath.result, 'resources', 'yaml', `${workflowName}.yml`));
    const starterFileAutoFillContent = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8')
                                            .replace('your-resource-group', resourceName)
                                            .replace('your-cluster-name', clusterName);

    return { succeeded: true, result: starterFileAutoFillContent };
}
