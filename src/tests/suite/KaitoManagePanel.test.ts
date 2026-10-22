import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { KaitoManagePanelDataProvider, parseServicePort } from "../../panels/KaitoManagePanel";
import { MessageSink } from "../../webview-contract/messaging";
import { ToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/kaitoManage";

describe("Kaito manage panel", () => {
    afterEach(() => {
        sinon.restore();
    });

    describe("parseServicePort", () => {
        it("accepts decimal ports in the valid range", () => {
            assert.strictEqual(parseServicePort("1"), 1);
            assert.strictEqual(parseServicePort("8080"), 8080);
            assert.strictEqual(parseServicePort("65535"), 65535);
            assert.strictEqual(parseServicePort(" 8080\n"), 8080);
        });

        it("rejects shell syntax and non-numeric output", () => {
            const payloads = [
                "8080&echo AKSC1RT_P3>P3.marker",
                "8080; touch /tmp/pwned",
                "8080 | whoami",
                "8080$(whoami)",
                "8080`whoami`",
                '8080" & whoami',
                "8080\nwhoami",
                "",
                "-1",
                "1.5",
                "65536",
                "999999999999999999999999",
            ];

            for (const payload of payloads) {
                assert.strictEqual(parseServicePort(payload), undefined, `should reject: ${payload}`);
            }
        });
    });

    it("does not create a terminal when the cluster returns the reported service-port payload", async () => {
        const invokeCommand = sinon.stub();
        invokeCommand.onFirstCall().resolves({ code: 0, stdout: "10.0.0.1", stderr: "" });
        invokeCommand.onSecondCall().resolves({ code: 0, stdout: "8080&echo AKSC1RT_P3>P3.marker", stderr: "" });

        const kubectl = {
            available: true,
            api: { invokeCommand, portForward: sinon.stub() },
        } as k8s.APIAvailable<k8s.KubectlV1>;
        const provider = new KaitoManagePanelDataProvider(
            "cluster",
            "subscription",
            "resource-group",
            kubectl,
            "/tmp/kubeconfig",
            [],
            undefined,
            {} as ReadyAzureSessionProvider,
        );

        sinon.stub(vscode.window, "showInputBox").resolves(undefined);
        const showErrorMessage = sinon.stub(vscode.window, "showErrorMessage");
        const createTerminal = sinon.stub(vscode.window, "createTerminal");
        const handler = provider.getMessageHandler({} as MessageSink<ToWebViewMsgDef>);

        handler.portForwardRequest({ modelName: "workspace-benign", namespace: "default" }, "portForwardRequest");
        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.ok(showErrorMessage.calledOnceWith("Service 'workspace-benign' returned an invalid port."));
        assert.ok(createTerminal.notCalled, "hostile service-port output must not reach a terminal");
    });
});
