import * as vscode from "vscode";
import { window } from "vscode";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { KickstartClusterDataProvider, KickstartClusterPanel } from "../../panels/KickstartClusterPanel";
import { ClusterLaunchContext } from "../../webview-contract/webviewDefinitions/kickstartCluster";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";

export async function kickstartCluster(context: vscode.ExtensionContext, launchContextArg?: unknown): Promise<void> {
    const config = vscode.workspace.getConfiguration("aks.kickstart");
    if (!config.get<boolean>("enabled", true)) {
        window.showWarningMessage(
            "The Kickstart agent is disabled. Enable it via the 'aks.kickstart.enabled' setting.",
        );
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(`Could not sign in to Azure: ${sessionProvider.error}`);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        window.showErrorMessage(extension.error);
        return;
    }

    const launchContext = parseLaunchContext(launchContextArg);
    const panel = new KickstartClusterPanel(extension.result.extensionUri);
    const dataProvider = new KickstartClusterDataProvider(sessionProvider.result, context, launchContext);
    panel.show(dataProvider);
    await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");
}

function parseLaunchContext(arg: unknown): ClusterLaunchContext {
    if (typeof arg === "string") {
        try {
            const parsed = JSON.parse(arg) as unknown;
            return parsed && typeof parsed === "object" ? (parsed as ClusterLaunchContext) : {};
        } catch {
            return {};
        }
    }
    if (arg && typeof arg === "object") {
        return arg as ClusterLaunchContext;
    }
    return {};
}
