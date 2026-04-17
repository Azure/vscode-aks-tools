import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as l10n from "@vscode/l10n";
import * as vscode from "vscode";
import { runContainerAssist } from "./aksContainerAssist";
import { ContainerAssistAction } from "./types";

const appModernizationExtensionId = "vscjava.migrate-java-to-azure";
const appModernizationViewCommand = "workbench.view.extension.azureJavaMigrationExplorer";

export async function containerizationApp(_context: IActionContext, target: unknown): Promise<void> {
    await runContainerAssist(_context, target, [ContainerAssistAction.GenerateDeployment]);
}

export async function deployAppWithAutomatedPipeline(_context: IActionContext, target: unknown): Promise<void> {
    await runContainerAssist(_context, target, [ContainerAssistAction.GenerateWorkflow]);
}

export async function migrateAndModernizeApp(): Promise<void> {
    const extension = vscode.extensions.getExtension(appModernizationExtensionId);

    if (!extension) {
        const install = l10n.t("Install Extension");
        const selection = await vscode.window.showInformationMessage(
            l10n.t("GitHub Copilot app modernization extension is not installed."),
            install,
        );

        if (selection === install) {
            await vscode.commands.executeCommand("workbench.extensions.installExtension", appModernizationExtensionId);
        }

        return;
    }

    if (!extension.isActive) {
        await extension.activate();
    }

    const availableCommands = new Set(await vscode.commands.getCommands(true));
    if (!availableCommands.has(appModernizationViewCommand)) {
        vscode.window.showErrorMessage(
            l10n.t("Unable to open GitHub Copilot app modernization view in the current VS Code session."),
        );
        return;
    }

    await vscode.commands.executeCommand(appModernizationViewCommand);
}
