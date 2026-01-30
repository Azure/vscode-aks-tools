import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ContainerAssistService } from "../../commands/aksContainerAssist/containerAssistService";
import { runContainerAssist } from "../../commands/aksContainerAssist/aksContainerAssist";
import { ContainerAssistAction, ContainerAssistQuickPickItem } from "../../commands/aksContainerAssist/types";

describe("Container Assist Tests", () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe("ContainerAssistService", () => {
        it("isAvailable returns error when containerAssistEnabledPreview is false", async () => {
            const service = new ContainerAssistService();
            const getConfigStub = sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(false),
            } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

            const result = await service.isAvailable();

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("Container Assist is not enabled"));
            getConfigStub.restore();
        });

        it("isAvailable returns success when containerAssistEnabledPreview is true", async () => {
            const service = new ContainerAssistService();
            const getConfigStub = sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(true),
            } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

            const result = await service.isAvailable();

            assert.strictEqual(result.succeeded, true);
            getConfigStub.restore();
        });

        it("analyzeRepository returns error when runtime initialization fails", async () => {
            const service = new ContainerAssistService();
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

            const result = await service.analyzeRepository("/test/path");

            // Should fail because createApp() will fail in test environment without Docker
            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("Failed to") || result.error.includes("initialize"));
            // Info message is shown before attempting execution
            assert.ok(showInfoStub.calledOnce);
        });

        it("generateDockerfile returns error when runtime initialization fails", async () => {
            const service = new ContainerAssistService();
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

            const result = await service.generateDockerfile("/test/path", {
                language: "node",
                framework: "express",
            });

            // Should fail because createApp() will fail in test environment without Docker
            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("Failed to") || result.error.includes("initialize"));
            // Info message is shown before attempting execution
            assert.ok(showInfoStub.calledOnce);
        });

        it("generateManifests returns error when runtime initialization fails", async () => {
            const service = new ContainerAssistService();
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

            const result = await service.generateManifests("/test/path", "Dockerfile", "test-app");

            // Should fail because createApp() will fail in test environment without Docker
            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("Failed to") || result.error.includes("initialize"));
            // Info message is shown before attempting execution
            assert.ok(showInfoStub.calledOnce);
        });

        it("generateDeploymentFiles orchestrates the workflow", async () => {
            const service = new ContainerAssistService();
            const analyzeStub = sandbox.stub(service, "analyzeRepository");
            const dockerfileStub = sandbox.stub(service, "generateDockerfile");
            const manifestsStub = sandbox.stub(service, "generateManifests");

            // Mock failure at analyze step
            analyzeStub.resolves({
                succeeded: false,
                error: "Analysis failed",
            });

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, false);
            assert.strictEqual(result.error, "Analysis failed");
            assert.ok(analyzeStub.calledOnce);
            assert.ok(dockerfileStub.notCalled);
            assert.ok(manifestsStub.notCalled);
        });

        it("generateDeploymentFiles fails at dockerfile generation", async () => {
            const service = new ContainerAssistService();
            const analyzeStub = sandbox.stub(service, "analyzeRepository");
            const dockerfileStub = sandbox.stub(service, "generateDockerfile");
            const manifestsStub = sandbox.stub(service, "generateManifests");

            analyzeStub.resolves({
                succeeded: true,
                result: { language: "node" },
            });

            dockerfileStub.resolves({
                succeeded: false,
                error: "Dockerfile generation failed",
            });

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, false);
            assert.strictEqual(result.error, "Dockerfile generation failed");
            assert.ok(analyzeStub.calledOnce);
            assert.ok(dockerfileStub.calledOnce);
            assert.ok(manifestsStub.notCalled);
        });
    });

    describe("runContainerAssist Command", () => {
        it("shows error when target is not a URI", async () => {
            const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

            await runContainerAssist({} as IActionContext, null);

            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("right-click on a folder"));
        });

        it("shows error when folder is not in workspace", async () => {
            const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");
            const getWorkspaceFolderStub = sandbox.stub(vscode.workspace, "getWorkspaceFolder").returns(undefined);
            const testUri = vscode.Uri.file("/test/path");

            await runContainerAssist({} as IActionContext, testUri);

            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("not part of a workspace"));
            getWorkspaceFolderStub.restore();
        });

        it("shows error when Container Assist is not available", async () => {
            const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");
            const testUri = vscode.Uri.file("/test/path");
            const workspaceFolder = {
                uri: testUri,
                name: "test",
                index: 0,
            } as vscode.WorkspaceFolder;

            const getWorkspaceFolderStub = sandbox
                .stub(vscode.workspace, "getWorkspaceFolder")
                .returns(workspaceFolder);
            const getConfigStub = sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(false),
            } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

            await runContainerAssist({} as IActionContext, testUri);

            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("Container Assist is not enabled"));
            getWorkspaceFolderStub.restore();
            getConfigStub.restore();
        });

        it("returns when user cancels QuickPick", async () => {
            const testUri = vscode.Uri.file("/test/path");
            const workspaceFolder = {
                uri: testUri,
                name: "test",
                index: 0,
            } as vscode.WorkspaceFolder;

            const getWorkspaceFolderStub = sandbox
                .stub(vscode.workspace, "getWorkspaceFolder")
                .returns(workspaceFolder);
            const getConfigStub = sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(true),
            } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);
            const showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);

            await runContainerAssist({} as IActionContext, testUri);

            // Should not throw and should have called QuickPick
            assert.ok(showQuickPickStub.calledOnce);
            getWorkspaceFolderStub.restore();
            getConfigStub.restore();
        });
    });

    describe("Error Handling", () => {
        it("handles exceptions in service methods gracefully", async () => {
            const service = new ContainerAssistService();

            // Force an exception by stubbing showInformationMessage to throw
            sandbox.stub(vscode.window, "showInformationMessage").throws(new Error("Test error"));

            const result = await service.analyzeRepository("/test/path");

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("Failed to analyze repository"));
        });

        it("service methods return Errorable pattern", async () => {
            const service = new ContainerAssistService();

            const analyzeResult = await service.analyzeRepository("/test");
            const dockerfileResult = await service.generateDockerfile("/test", {});
            const manifestsResult = await service.generateManifests("/test", "Dockerfile", "app");

            // All should return Errorable with succeeded property
            assert.ok("succeeded" in analyzeResult);
            assert.ok("succeeded" in dockerfileResult);
            assert.ok("succeeded" in manifestsResult);

            // All should have error property when failed
            if (!analyzeResult.succeeded) {
                assert.ok("error" in analyzeResult);
            }
            if (!dockerfileResult.succeeded) {
                assert.ok("error" in dockerfileResult);
            }
            if (!manifestsResult.succeeded) {
                assert.ok("error" in manifestsResult);
            }
        });
    });

    describe("Integration Tests", () => {
        it("QuickPick items are correctly structured", async () => {
            const testUri = vscode.Uri.file("/test/path");
            const workspaceFolder = {
                uri: testUri,
                name: "test",
                index: 0,
            } as vscode.WorkspaceFolder;

            const getWorkspaceFolderStub = sandbox
                .stub(vscode.workspace, "getWorkspaceFolder")
                .returns(workspaceFolder);
            const getConfigStub = sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(true),
            } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

            const capturedItems: ContainerAssistQuickPickItem[] = [];
            const showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick").callsFake((items: unknown) => {
                if (Array.isArray(items)) {
                    capturedItems.push(...(items as ContainerAssistQuickPickItem[]));
                }
                return Promise.resolve(undefined);
            });

            await runContainerAssist({} as IActionContext, testUri);

            // Verify QuickPick items
            assert.ok(showQuickPickStub.calledOnce);
            assert.strictEqual(capturedItems.length, 2);
            assert.ok(capturedItems[0].label.includes("Generate Deployment Files"));
            assert.ok(capturedItems[1].label.includes("Generate Default Workflow"));
            assert.strictEqual(capturedItems[0].action, ContainerAssistAction.GenerateDeployment);
            assert.strictEqual(capturedItems[1].action, ContainerAssistAction.GenerateWorkflow);

            getWorkspaceFolderStub.restore();
            getConfigStub.restore();
        });
    });
});
