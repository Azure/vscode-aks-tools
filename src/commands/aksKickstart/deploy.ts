import * as vscode from "vscode";
import * as path from "path";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ClusterKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";

export interface DeployArgs {
    projectPath: string;
    clusterKey?: ClusterKey;
    manifestsPath?: string;
}

export async function deploy(_ctx: IActionContext, args: DeployArgs): Promise<void> {
    const manifestsPath = args.manifestsPath ?? path.join(args.projectPath, "k8s");

    let yamlFiles: [string, vscode.FileType][];
    try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(manifestsPath));
        yamlFiles = entries.filter(([name]) => name.endsWith(".yaml") || name.endsWith(".yml"));
    } catch {
        yamlFiles = [];
    }

    if (yamlFiles.length === 0) {
        const choice = await vscode.window.showErrorMessage("No manifests found. Save manifests first.", "Save now");
        if (choice === "Save now") {
            await vscode.commands.executeCommand("aks.kickstart.saveAll");
        }
        return;
    }

    try {
        await vscode.commands.executeCommand("aks.aksDeployManifest", {
            clusterKey: args.clusterKey,
            manifestsPath,
        });
    } catch {
        const terminal = vscode.window.createTerminal({
            name: "AKS Kickstart Deploy",
            cwd: manifestsPath,
        });
        terminal.sendText("kubectl apply -f .");
        terminal.show();
    }

    vscode.window.showInformationMessage("Deploy started.");
}
