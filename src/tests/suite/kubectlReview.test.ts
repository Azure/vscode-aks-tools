import * as assert from "assert";
import childProcess from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import * as kubectl from "../../commands/utils/kubectl";
import * as kaito from "../../panels/utilities/KaitoHelpers";
import { KaitoTestPanelDataProvider } from "../../panels/KaitoTestPanel";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { MessageSink } from "../../webview-contract/messaging";
import { ToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/kaitoTest";
import { NonZeroExitCodeBehaviour } from "../../commands/utils/shell";
import { argoCDPostApplyActions } from "../../commands/aksArgoCD/argoCDApplyApp";

describe("Kubectl review regressions", () => {
    afterEach(() => sinon.restore());

    it("does not give one-shot commands to the dependency's retained-child launcher", async () => {
        const child = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            stdin: new PassThrough(),
        });
        const spawn = sinon.stub(childProcess, "spawn").returns(child as unknown as childProcess.ChildProcess);
        const legacySpawnAsChild = sinon.stub().resolves(child);
        const api = { kubectl: { legacySpawnAsChild } } as unknown as k8s.KubectlV1;
        const config = {
            get: (key: string, fallback: unknown) => (key === "vs-kubernetes" ? {} : fallback),
            inspect: (key: string) =>
                key === "vscode-kubernetes.kubectl-path" ? { globalValue: process.execPath } : undefined,
        } as unknown as vscode.WorkspaceConfiguration;
        sinon.stub(vscode.workspace, "getConfiguration").returns(config);
        setImmediate(() => child.emit("close", 0));

        const result = await kubectl.invokeKubectlCommandArgs({ available: true, api }, "/tmp/kubeconfig", [
            "get",
            "pods",
        ]);

        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        sinon.assert.notCalled(legacySpawnAsChild);
        sinon.assert.calledOnce(spawn);
        assert.strictEqual(spawn.firstCall.args[2]?.shell, false);
    });

    it("redacts split-form literal values without changing their arguments", () => {
        const args = ["create", "secret", "generic", "repo", "--from-literal", "password=private-token=tail"];

        assert.strictEqual(
            kubectl.describeKubectlCommand(args),
            "kubectl create secret generic repo --from-literal password=***",
        );
        assert.strictEqual(args[5], "password=private-token=tail");
    });

    it("keeps KAITO request bodies out of command descriptions", () => {
        const args = kaito.createCurlPodArgs("curl-test", "workspace-phi", "10.0.0.1", "private prompt", 1, 1, 1, 1, 1);

        assert.ok(!kubectl.describeKubectlCommand(args).includes("private prompt"));
        assert.ok(args[args.length - 1].includes("private prompt"));
    });

    it("preserves both leading backslashes in a double-quoted UNC path", () => {
        const result = kubectl.parseKubectlCommandArgs(String.raw`apply -f "\\server\team share\app.yaml"`);

        assert.deepStrictEqual(result, {
            succeeded: true,
            result: ["apply", "-f", String.raw`\\server\team share\app.yaml`],
        });
    });

    it("marks KAITO request-body arguments as sensitive", async () => {
        sinon.stub(kaito, "getClusterIP").resolves("10.0.0.1");
        sinon.stub(kaito, "getWorkspaceRuntime").resolves("vllm");
        const invoke = sinon.stub(kubectl, "invokeKubectlCommandArgs");
        invoke.resolves({ succeeded: true, result: { code: 0, stdout: "", stderr: "" } });
        invoke.onSecondCall().resolves({
            succeeded: true,
            result: { code: 0, stdout: JSON.stringify({ choices: [{ text: "answer" }] }), stderr: "" },
        });
        const provider = new KaitoTestPanelDataProvider(
            "cluster",
            "subscription",
            "resource-group",
            { api: {} } as k8s.APIAvailable<k8s.KubectlV1>,
            "/tmp/kubeconfig",
            {} as ReadyAzureSessionProvider,
            "workspace-phi",
            "default",
        );
        let updated: (() => void) | undefined;
        const completed = new Promise<void>((resolve) => (updated = resolve));
        const webview = { postTestUpdate: () => updated?.() } as unknown as MessageSink<ToWebViewMsgDef>;

        provider
            .getMessageHandler(webview)
            .queryRequest(
                { prompt: "private prompt", temperature: 1, topP: 1, topK: 1, repetitionPenalty: 1, maxLength: 1 },
                "queryRequest",
            );
        await completed;
        await new Promise<void>((resolve) => setImmediate(resolve));

        const createCall: unknown[] = invoke.firstCall.args;
        const args = createCall[2] as string[];
        assert.deepStrictEqual(createCall[4], { sensitiveArgs: [args.length - 1] });
    });

    it("preserves the Snap stdout pipe without hiding kubectl's nonzero exit", async () => {
        const makeChild = () =>
            Object.assign(new EventEmitter(), {
                stdout: new PassThrough(),
                stderr: new PassThrough(),
                stdin: new PassThrough(),
            });
        const source = makeChild();
        const sink = makeChild();
        const spawn = sinon.stub(childProcess, "spawn");
        spawn.onFirstCall().returns(source as unknown as childProcess.ChildProcess);
        spawn.onSecondCall().returns(sink as unknown as childProcess.ChildProcess);
        const config = {
            get: (key: string, fallback: unknown) =>
                key === "vs-kubernetes" ? { "vs-kubernetes.enable-snap-flag": true } : fallback,
            inspect: (key: string) =>
                key === "vscode-kubernetes.kubectl-path" ? { globalValue: process.execPath } : undefined,
        } as unknown as vscode.WorkspaceConfiguration;
        sinon.stub(vscode.workspace, "getConfiguration").returns(config);
        const legacySpawnAsChild = sinon.stub().resolves(source);
        const api = { kubectl: { legacySpawnAsChild } } as unknown as k8s.KubectlV1;
        setImmediate(() => {
            source.stdout.end("partial output");
            source.stderr.end("Forbidden");
            sink.stdout.end("partial output");
            source.emit("close", 7);
            sink.emit("close", 0);
        });

        const result = await kubectl.invokeKubectlCommandArgs(
            { available: true, api },
            "/tmp/kubeconfig",
            ["get", "pods"],
            NonZeroExitCodeBehaviour.Succeed,
        );

        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        assert.deepStrictEqual(result.result, { code: 7, stdout: "partial output", stderr: "Forbidden" });
        sinon.assert.calledTwice(spawn);
        assert.strictEqual(spawn.secondCall.args[0], "cat");
        assert.strictEqual(spawn.secondCall.args[2]?.shell, false);
        assert.strictEqual(sink.stdin.read()?.toString(), "partial output");
    });

    it("sends the Argo CD PAT only on stdin and labels the Secret when it is created", async () => {
        const pick = sinon.stub(vscode.window, "showQuickPick");
        pick.onFirstCall().resolves({ id: "connect_repo", label: "Connect repository" } as vscode.QuickPickItem);
        pick.onSecondCall().resolves(undefined);
        sinon.stub(vscode.window, "showInformationMessage").resolves(undefined);
        sinon.stub(vscode.window, "showInputBox").resolves("private-token=tail");
        sinon.stub(vscode.authentication, "getSession").resolves(undefined);
        const invoke = sinon.stub(kubectl, "invokeKubectlCommandArgs").resolves({
            succeeded: true,
            result: { code: 0, stdout: "secret/argocd-repo-repo created", stderr: "" },
        });

        await argoCDPostApplyActions(
            undefined,
            { api: {} },
            "/tmp/kubeconfig",
            "cluster",
            "app",
            "https://github.com/org/repo.git",
            "admin-password",
            "private",
            "unknown",
        );

        sinon.assert.calledTwice(invoke);
        assert.deepStrictEqual(invoke.firstCall.args[2], [
            "delete",
            "secret",
            "argocd-repo-repo",
            "-n",
            "argocd",
            "--ignore-not-found",
        ]);
        const [, , args, behaviour, options] = invoke.secondCall.args;
        assert.deepStrictEqual(args, ["create", "-f", "-"]);
        assert.strictEqual(behaviour, NonZeroExitCodeBehaviour.Fail);
        assert.strictEqual(options?.sensitiveStdin, true);
        assert.deepStrictEqual(JSON.parse(options?.stdin ?? ""), {
            apiVersion: "v1",
            kind: "Secret",
            metadata: {
                name: "argocd-repo-repo",
                namespace: "argocd",
                labels: { "argocd.argoproj.io/secret-type": "repository" },
            },
            type: "Opaque",
            stringData: {
                type: "git",
                url: "https://github.com/org/repo.git",
                username: "git",
                password: "private-token=tail",
            },
        });
        assert.ok(invoke.args.every((call) => !JSON.stringify(call.slice(0, 4)).includes("private-token")));
    });
});
