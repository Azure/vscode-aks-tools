import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as l10n from "@vscode/l10n";
import * as vscode from "vscode";

const SETTING_SECTION = "aks";
const SETTING_KEY = "simplifiedMenuStructure";

async function setSimplifiedMenuStructure(enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration(SETTING_SECTION);
    const current = config.get<boolean>(SETTING_KEY);
    if (current === enabled) {
        return;
    }
    await config.update(SETTING_KEY, enabled, vscode.ConfigurationTarget.Global);
}

async function promptReload(message: string): Promise<void> {
    const RELOAD = l10n.t("Reload Window");
    const choice = await vscode.window.showInformationMessage(message, RELOAD);
    if (choice === RELOAD) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}

export async function switchToClassicMenu(_context: IActionContext, _target?: unknown): Promise<void> {
    void _context;
    void _target;
    await setSimplifiedMenuStructure(false);
    await promptReload(
        l10n.t(
            "Classic AKS menu restored. Reload the window for the change to take effect. You can switch back at any time with 'Switch to Grouped Menu'.",
        ),
    );
}

export async function switchToStructuredMenu(_context: IActionContext, _target?: unknown): Promise<void> {
    void _context;
    void _target;
    await setSimplifiedMenuStructure(true);
    await promptReload(
        l10n.t(
            "Grouped AKS menu enabled. Reload the window for the change to take effect. You can switch back at any time with 'Take me back to Classic Menu'.",
        ),
    );
}
