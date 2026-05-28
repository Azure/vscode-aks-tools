import * as l10n from "@vscode/l10n";
import { Uri, window, workspace, ExtensionContext } from "vscode";
import { KickstartState, loadState, saveState } from "../../chatParticipants/kickstart/state";

const encoder = new TextEncoder();

export async function triggerAcceptAll(context: ExtensionContext): Promise<void> {
    const workspaceFolders = workspace.workspaceFolders;
    if (!workspaceFolders?.length) return;

    const workspaceFolder = workspaceFolders[0].uri.fsPath;
    const state = loadState(context, workspaceFolder);
    if (!state) return;

    const stagedFiles = state.artifacts?.stagedFiles ?? [];

    const workspaceRoot = workspaceFolders[0].uri;
    for (const f of stagedFiles) {
        if (f.status === "rejected") continue;
        const dest = Uri.joinPath(workspaceRoot, f.filename);
        await workspace.fs.writeFile(dest, encoder.encode(f.content));
    }

    const updated = stagedFiles.map((f) => (f.status !== "rejected" ? { ...f, status: "accepted" as const } : f));
    const newState: KickstartState = {
        ...state,
        artifacts: { stagedFiles: updated, savedToDisk: true },
    };
    await saveState(context, workspaceFolder, newState);
    const count = updated.filter((f) => f.status === "accepted").length;
    window.showInformationMessage(l10n.t("Saved {0} file(s) to project.", count));
}
