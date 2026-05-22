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

    it("cloneSample uses a unique target when the default exists", async () => {
        const clone = sandbox.spy(async () => "/tmp/parent/sample-1");
        const getAPI = sandbox.stub().returns({ clone });
        const statStub = sandbox.stub(vscode.workspace.fs, "stat");
        statStub.onFirstCall().resolves();
        statStub.onSecondCall().rejects(new Error("not found"));

        sandbox.stub(vscode.extensions, "getExtension").returns({
            isActive: true,
            activate: sandbox.spy(async () => undefined),
            exports: { getAPI },
        } as unknown as vscode.Extension<unknown>);

        const token = new vscode.CancellationTokenSource().token;
        const result = await cloneSample("https://example.com/repo.git", "/tmp/parent", "sample", token);

        assert.deepStrictEqual(result, {
            succeeded: true,
            result: "/tmp/parent/sample-1",
        });
        assert.ok(clone.calledOnce);
    });
});
