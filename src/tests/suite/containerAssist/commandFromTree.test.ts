import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { runContainerAssistFromTree } from "../../../commands/aksContainerAssist/aksContainerAssist";
import * as clusters from "../../../commands/utils/clusters";

describe("runContainerAssistFromTree Command", () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("errors when target is an invalid (non-AKS) tree node", async () => {
        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

        // Stub the k8s cloud explorer API
        sandbox.stub(k8s.extension.cloudExplorer, "v1").value(
            Promise.resolve({
                available: true,
                api: {
                    resolveCommandTarget: () => undefined,
                },
            }),
        );

        await runContainerAssistFromTree({} as IActionContext, { someInvalidNode: true });

        assert.ok(showErrorStub.calledOnce);
        assert.ok(showErrorStub.firstCall.args[0].includes("This command only applies to AKS clusters"));
    });

    it("errors when no workspace folder is found", async () => {
        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

        // Stub getAksClusterTreeNode to return success
        sandbox.stub(clusters, "getAksClusterTreeNode").returns({
            succeeded: true,
            result: {
                subscriptionId: "sub-123",
                resourceGroupName: "rg-test",
                name: "test-cluster",
            },
        } as ReturnType<typeof clusters.getAksClusterTreeNode>);

        // Stub the k8s cloud explorer API
        sandbox.stub(k8s.extension.cloudExplorer, "v1").value(
            Promise.resolve({
                available: true,
                api: {
                    resolveCommandTarget: () => undefined,
                },
            }),
        );

        // No workspace folders
        sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);

        await runContainerAssistFromTree({} as IActionContext, {});

        assert.ok(showErrorStub.calledOnce);
        assert.ok(showErrorStub.firstCall.args[0].includes("No workspace folder found"));
    });

    it("errors when Container Assist feature is disabled", async () => {
        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");
        const testUri = vscode.Uri.file("/test/path");

        // Stub getAksClusterTreeNode to return success
        sandbox.stub(clusters, "getAksClusterTreeNode").returns({
            succeeded: true,
            result: {
                subscriptionId: "sub-123",
                resourceGroupName: "rg-test",
                name: "test-cluster",
            },
        } as ReturnType<typeof clusters.getAksClusterTreeNode>);

        // Stub the k8s cloud explorer API
        sandbox.stub(k8s.extension.cloudExplorer, "v1").value(
            Promise.resolve({
                available: true,
                api: {
                    resolveCommandTarget: () => undefined,
                },
            }),
        );

        // Single workspace folder
        sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: testUri, name: "test", index: 0 }]);

        // Container Assist disabled
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns(false),
        } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

        await runContainerAssistFromTree({} as IActionContext, {});

        assert.ok(showErrorStub.calledOnce);
        assert.ok(showErrorStub.firstCall.args[0].includes("Container Assist is not enabled"));
    });
});
