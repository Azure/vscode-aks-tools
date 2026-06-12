import * as vscode from "vscode";
import { window } from "vscode";
import { KickstartGuidedSetupDataProvider, KickstartGuidedSetupPanel } from "../../panels/KickstartGuidedSetupPanel";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";

export async function kickstartLaunch(): Promise<void> {
    const config = vscode.workspace.getConfiguration("aks.kickstart");
    if (!config.get<boolean>("enabled", true)) {
        window.showWarningMessage(
            "The Kickstart agent is disabled. Enable it via the 'aks.kickstart.enabled' setting.",
        );
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        window.showErrorMessage(extension.error);
        return;
    }

    const panel = new KickstartGuidedSetupPanel(extension.result.extensionUri);
    const dataProvider = new KickstartGuidedSetupDataProvider();
    panel.show(dataProvider);
    await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");
}
