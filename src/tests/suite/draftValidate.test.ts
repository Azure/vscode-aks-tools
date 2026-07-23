import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as shell from "../../commands/utils/shell";
import { NonZeroExitCodeBehaviour } from "../../commands/utils/shell";
import { DraftValidateDataProvider } from "../../panels/draft/DraftValidatePanel";
import { isYamlManifestFile, canRunDraftValidate } from "../../commands/draft/draftCommands";
import { MessageSink } from "../../webview-contract/messaging";
import { ToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/draft/draftValidate";

describe("isYamlManifestFile", () => {
    it("accepts .yaml and .yml files (case-insensitive)", () => {
        for (const f of ["deployment.yaml", "deployment.yml", "k8s/app.yaml", "App.YAML", "x.YML"]) {
            assert.strictEqual(isYamlManifestFile(f), true, f);
        }
    });

    it("rejects non-YAML files", () => {
        for (const f of ["notes.txt", "Dockerfile", "config.json", "archive.yaml.bak", "", ".yamlfile"]) {
            assert.strictEqual(isYamlManifestFile(f), false, f);
        }
    });
});

describe("canRunDraftValidate", () => {
    it("accepts a folder (any name)", () => {
        assert.strictEqual(canRunDraftValidate("k8s", true), true);
        assert.strictEqual(canRunDraftValidate("some/nested/dir", true), true);
    });

    it("accepts a .yaml/.yml file", () => {
        assert.strictEqual(canRunDraftValidate("k8s/deployment.yaml", false), true);
        assert.strictEqual(canRunDraftValidate("App.YML", false), true);
    });

    it("rejects an empty selection (e.g. Command Palette / tree node)", () => {
        assert.strictEqual(canRunDraftValidate("", false), false);
        assert.strictEqual(canRunDraftValidate("", true), false);
    });

    it("rejects a non-YAML file", () => {
        assert.strictEqual(canRunDraftValidate("notes.txt", false), false);
        assert.strictEqual(canRunDraftValidate("Dockerfile", false), false);
    });
});

describe("DraftValidate handler", () => {
    let sandbox: sinon.SinonSandbox;
    let postValidationResult: sinon.SinonStub;

    const workspaceFolder = {
        uri: vscode.Uri.file("/ws"),
        name: "ws",
        index: 0,
    } as vscode.WorkspaceFolder;

    function makeProvider(initialLocation: string): DraftValidateDataProvider {
        return new DraftValidateDataProvider(workspaceFolder, "/tools/draft/draft", initialLocation);
    }

    async function runValidate(initialLocation: string): Promise<void> {
        const provider = makeProvider(initialLocation);
        const webview = { postValidationResult } as unknown as MessageSink<ToWebViewMsgDef>;
        await provider.getMessageHandler(webview).createDraftValidateRequest("", "createDraftValidateRequest");
    }

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        postValidationResult = sandbox.stub();
    });

    afterEach(() => sandbox.restore());

    it("quotes the manifest path and tolerates non-zero exit codes (findings are not errors)", async () => {
        const execStub = sandbox
            .stub(shell, "exec")
            .resolves({ succeeded: true, result: { code: 3, stdout: "FAIL: replicas too low", stderr: "" } });

        await runValidate("my k8s/deployment.yaml");

        const [command, options] = execStub.firstCall.args;
        assert.match(
            command as string,
            /draft validate --manifest ".+deployment\.yaml"/,
            "manifest path must be quoted",
        );
        assert.strictEqual(
            (options as shell.ShellOptions).exitCodeBehaviour,
            NonZeroExitCodeBehaviour.Succeed,
            "policy violations (non-zero exit) must be treated as results, not a command failure",
        );
    });

    it("surfaces validation findings from stdout in the results panel", async () => {
        sandbox
            .stub(shell, "exec")
            .resolves({ succeeded: true, result: { code: 1, stdout: "FAIL: missing limits", stderr: "" } });

        await runValidate("k8s/deployment.yaml");

        assert.strictEqual(postValidationResult.firstCall.args[0].result, "FAIL: missing limits");
    });

    it("combines stdout and stderr output", async () => {
        sandbox
            .stub(shell, "exec")
            .resolves({ succeeded: true, result: { code: 1, stdout: "stdout finding", stderr: "stderr note" } });

        await runValidate("k8s/deployment.yaml");

        assert.strictEqual(postValidationResult.firstCall.args[0].result, "stdout finding\n\nstderr note");
    });

    it("reports a placeholder when draft produces no output", async () => {
        sandbox.stub(shell, "exec").resolves({ succeeded: true, result: { code: 0, stdout: "", stderr: "" } });

        await runValidate("k8s/deployment.yaml");

        assert.match(postValidationResult.firstCall.args[0].result, /no output/i);
    });

    it("shows an error message when draft cannot be executed", async () => {
        sandbox.stub(shell, "exec").resolves({ succeeded: false, error: "draft binary not found" });
        const showError = sandbox.stub(vscode.window, "showErrorMessage");

        await runValidate("k8s/deployment.yaml");

        assert.ok(showError.calledOnceWith("draft binary not found"));
        assert.ok(postValidationResult.notCalled, "no results should be posted on execution failure");
    });
});
