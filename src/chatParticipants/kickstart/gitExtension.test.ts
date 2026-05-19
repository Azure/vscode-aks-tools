import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { cloneSample, getGitApi } from "./gitExtension";

describe("kickstart gitExtension", () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("returns an error when the Git extension is missing", async () => {
        sandbox.stub(vscode.extensions, "getExtension").returns(undefined);

        const result = await getGitApi();

        assert.deepStrictEqual(result, {
            succeeded: false,
            error: "Git extension is not installed",
        });
    });

    it("activates the Git extension when it is inactive", async () => {
        const activate = sandbox.spy(async () => undefined);
        const clone = sandbox.spy(async () => "/tmp/test-repo");
        const getAPI = sandbox.stub().returns({ clone });

        sandbox.stub(vscode.extensions, "getExtension").returns({
            isActive: false,
            activate,
            exports: { getAPI },
        } as unknown as vscode.Extension<unknown>);

        const result = await getGitApi();

        assert.ok(result.succeeded);
        assert.ok(activate.calledOnce);
    });

    it("returns an error when the Git API is unavailable", async () => {
        const activate = sandbox.spy(async () => undefined);

        sandbox.stub(vscode.extensions, "getExtension").returns({
            isActive: true,
            activate,
            exports: {
                getAPI: () => {
                    throw new Error("missing api");
                },
            },
        } as unknown as vscode.Extension<unknown>);

        const result = await getGitApi();

        assert.deepStrictEqual(result, {
            succeeded: false,
            error: "Git extension API unavailable — enable the built-in Git extension and reload window",
        });
    });

    it("cloneSample passes postCloneAction: 'none' to suppress the open-after-clone prompt", async () => {
        const cloneResultUri = vscode.Uri.file("/tmp/parent/sample");
        const clone = sandbox.spy(async () => cloneResultUri);
        const getAPI = sandbox.stub().returns({ clone });
        // pathExists check after clone: report the path exists.
        sandbox.stub(vscode.workspace.fs, "stat").resolves();

        sandbox.stub(vscode.extensions, "getExtension").returns({
            isActive: true,
            activate: sandbox.spy(async () => undefined),
            exports: { getAPI },
        } as unknown as vscode.Extension<unknown>);

        const token = new vscode.CancellationTokenSource().token;
        const result = await cloneSample("https://example.com/repo.git", "/tmp/parent", "sample", token);

        assert.deepStrictEqual(result, {
            succeeded: true,
            result: cloneResultUri.fsPath,
        });
        assert.ok(clone.calledOnce);
        const [uriArg, optionsArg] = clone.firstCall.args as unknown as [
            vscode.Uri,
            { parentPath?: vscode.Uri; recursive?: boolean; postCloneAction?: string },
        ];
        assert.strictEqual(uriArg.toString(), vscode.Uri.parse("https://example.com/repo.git").toString());
        assert.strictEqual(optionsArg.parentPath?.fsPath, vscode.Uri.file("/tmp/parent").fsPath);
        assert.strictEqual(optionsArg.recursive, true);
        assert.strictEqual(optionsArg.postCloneAction, "none");
    });
});
