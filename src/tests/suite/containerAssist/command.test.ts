import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { promises as fs } from "fs";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { runContainerAssist, pickWorkspaceFolder } from "../../../commands/aksContainerAssist/aksContainerAssist";
import { ContainerAssistAction, ContainerAssistQuickPickItem } from "../../../commands/aksContainerAssist/types";

describe("runContainerAssist Command", () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("errors when target is not a URI", async () => {
        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

        await runContainerAssist({} as IActionContext, null);

        assert.ok(showErrorStub.calledOnce);
        assert.ok(showErrorStub.firstCall.args[0].includes("right-click on a folder"));
    });

    it("errors when folder not in workspace", async () => {
        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");
        sandbox.stub(vscode.workspace, "getWorkspaceFolder").returns(undefined);

        await runContainerAssist({} as IActionContext, vscode.Uri.file("/test/path"));

        assert.ok(showErrorStub.calledOnce);
        assert.ok(showErrorStub.firstCall.args[0].includes("not part of a workspace"));
    });

    it("errors when Container Assist disabled", async () => {
        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");
        const testUri = vscode.Uri.file("/test/path");

        sandbox.stub(vscode.workspace, "getWorkspaceFolder").returns({
            uri: testUri,
            name: "test",
            index: 0,
        } as vscode.WorkspaceFolder);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns(false),
        } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

        await runContainerAssist({} as IActionContext, testUri);

        assert.ok(showErrorStub.calledOnce);
        assert.ok(showErrorStub.firstCall.args[0].includes("Container Assist is not enabled"));
    });

    function stubWorkspaceReady(testUri: vscode.Uri) {
        sandbox.stub(vscode.workspace, "getWorkspaceFolder").returns({
            uri: testUri,
            name: "test",
            index: 0,
        } as vscode.WorkspaceFolder);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns(true),
        } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);
        sandbox.stub(fs, "stat").resolves({ isFile: () => false } as Awaited<ReturnType<typeof fs.stat>>);
        sandbox.stub(fs, "readdir").resolves([]);
        sandbox.stub(fs, "access").rejects(new Error("File not found"));
    }

    it("shows exit confirmation when action QuickPick is cancelled", async () => {
        const testUri = vscode.Uri.file("/test/path");
        stubWorkspaceReady(testUri);

        sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
        // Simulate the user clicking "Exit Container Assist" in the confirmation modal.
        const showWarningStub = sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);

        await runContainerAssist({} as IActionContext, testUri);

        assert.ok(showWarningStub.calledOnce, "exit confirmation modal should be shown when QuickPick is cancelled");
        assert.ok((showWarningStub.firstCall.args[0] as string).includes("exit the Container Assist wizard"));
    });

    it("re-shows QuickPick when user clicks Go Back in the exit confirmation", async () => {
        const testUri = vscode.Uri.file("/test/path");
        stubWorkspaceReady(testUri);

        // First QuickPick call → cancelled; second QuickPick call → cancelled (to end the test).
        const showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
        // First showWarningMessage → "Go Back"; second → dismiss (undefined) to actually exit.
        const showWarningStub = sandbox
            .stub(vscode.window, "showWarningMessage")
            .onFirstCall()
            .resolves("Go Back" as unknown as vscode.MessageItem)
            .onSecondCall()
            .resolves(undefined);

        await runContainerAssist({} as IActionContext, testUri);

        assert.strictEqual(showQuickPickStub.callCount, 2, "QuickPick should be shown again after Go Back");
        assert.strictEqual(showWarningStub.callCount, 2, "exit confirmation should appear twice");
    });

    it("returns on cancelled QuickPick when user exits the wizard", async () => {
        const testUri = vscode.Uri.file("/test/path");
        stubWorkspaceReady(testUri);

        const showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
        // Dismiss the exit confirmation → wizard exits cleanly.
        sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);

        await runContainerAssist({} as IActionContext, testUri);

        assert.ok(showQuickPickStub.calledOnce);
    });

    // ─── pickWorkspaceFolder cancellation (multi-folder workspace) ────────────

    it("shows exit confirmation when workspace folder picker is cancelled", async () => {
        const folders: vscode.WorkspaceFolder[] = [
            { uri: vscode.Uri.file("/folder1"), name: "folder1", index: 0 },
            { uri: vscode.Uri.file("/folder2"), name: "folder2", index: 1 },
        ];
        sandbox.stub(vscode.workspace, "workspaceFolders").value(folders);

        sandbox.stub(vscode.window, "showWorkspaceFolderPick").resolves(undefined);
        const showWarningStub = sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);

        const result = await pickWorkspaceFolder();

        assert.strictEqual(result, undefined);
        assert.ok(
            showWarningStub.calledOnce,
            "exit confirmation modal should be shown when workspace folder picker is cancelled",
        );
        assert.ok((showWarningStub.firstCall.args[0] as string).includes("exit the Container Assist wizard"));
    });

    it("re-shows workspace folder picker when user clicks Go Back", async () => {
        const folders: vscode.WorkspaceFolder[] = [
            { uri: vscode.Uri.file("/folder1"), name: "folder1", index: 0 },
            { uri: vscode.Uri.file("/folder2"), name: "folder2", index: 1 },
        ];
        sandbox.stub(vscode.workspace, "workspaceFolders").value(folders);

        // Both folder picker calls return undefined (cancelled).
        const folderPickStub = sandbox.stub(vscode.window, "showWorkspaceFolderPick").resolves(undefined);
        // First confirmation → "Go Back"; second → dismiss.
        sandbox
            .stub(vscode.window, "showWarningMessage")
            .onFirstCall()
            .resolves("Go Back" as unknown as vscode.MessageItem)
            .onSecondCall()
            .resolves(undefined);

        const result = await pickWorkspaceFolder();

        assert.strictEqual(result, undefined);
        assert.strictEqual(folderPickStub.callCount, 2, "folder picker should be shown again after Go Back");
    });

    // ─── QuickPick item structure ─────────────────────────────────────────────

    it("has correctly structured QuickPick items", async () => {
        const testUri = vscode.Uri.file("/test/path");
        stubWorkspaceReady(testUri);

        const capturedItems: ContainerAssistQuickPickItem[] = [];
        sandbox.stub(vscode.window, "showQuickPick").callsFake((items: unknown) => {
            if (Array.isArray(items)) {
                capturedItems.push(...(items as ContainerAssistQuickPickItem[]));
            }
            return Promise.resolve(undefined);
        });
        sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);

        await runContainerAssist({} as IActionContext, testUri);

        assert.strictEqual(capturedItems.length, 2);
        assert.ok(capturedItems[0].label.includes("Generate Deployment Files"));
        assert.ok(capturedItems[1].label.includes("Generate GitHub Workflow"));
        assert.strictEqual(capturedItems[0].action, ContainerAssistAction.GenerateDeployment);
        assert.strictEqual(capturedItems[1].action, ContainerAssistAction.GenerateWorkflow);
    });
});
