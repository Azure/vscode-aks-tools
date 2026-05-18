import { Uri, window, workspace, ExtensionContext } from "vscode";
import { KickstartState, loadState, saveState } from "../../chatParticipants/kickstart/state";

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
        await workspace.fs.writeFile(dest, Buffer.from(f.content, "utf8"));
    }

    const updated = stagedFiles.map((f) => (f.status !== "rejected" ? { ...f, status: "accepted" as const } : f));
    const newState: KickstartState = {
        ...state,
        artifacts: { stagedFiles: updated, savedToDisk: true },
    };
    await saveState(context, workspaceFolder, newState);
    const count = updated.filter((f) => f.status === "accepted").length;
    window.showInformationMessage(`Saved ${count} file(s) to project.`);
}
