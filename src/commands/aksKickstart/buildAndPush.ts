import * as vscode from "vscode";
import * as path from "path";
import { IActionContext } from "@microsoft/vscode-azext-utils";

export interface BuildAndPushArgs {
    projectPath: string;
    acrLoginServer?: string;
    imageName?: string;
}

export async function buildAndPush(_ctx: IActionContext, args: BuildAndPushArgs): Promise<void> {
    let acrLoginServer = args.acrLoginServer;
    if (!acrLoginServer) {
        acrLoginServer = await vscode.window.showInputBox({
            prompt: "ACR login server (e.g., myacr.azurecr.io)",
            placeHolder: "myacr.azurecr.io",
        });
        if (!acrLoginServer) {
            return;
        }
    }

    const acrName = acrLoginServer.split(".")[0];
    const imageName = args.imageName ?? path.basename(args.projectPath ?? "app");

    const terminal = vscode.window.createTerminal({ name: "AKS Kickstart Build", cwd: args.projectPath });
    terminal.sendText(`az acr build --registry ${acrName} --image ${imageName}:latest .`);
    terminal.show();

    vscode.window.showInformationMessage("Started build in terminal. Check progress in 'AKS Kickstart Build'.");
}
