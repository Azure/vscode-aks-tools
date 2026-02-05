import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ContainerAssistService } from "../../commands/aksContainerAssist/containerAssistService";
import { runContainerAssist } from "../../commands/aksContainerAssist/aksContainerAssist";
import {
    ContainerAssistAction,
    ContainerAssistQuickPickItem,
    ModuleAnalysisResult,
} from "../../commands/aksContainerAssist/types";

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

        it("analyzeRepository returns error when SDK call fails", async () => {
            const service = new ContainerAssistService();

            const result = await service.analyzeRepository("/test/path");

            // Should fail because SDK analyzeRepo will fail in test environment
            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("Failed to") || result.error.includes("analyze"));
        });

        it("generateDockerfile returns error when Language Model not available", async () => {
            const service = new ContainerAssistService();

            const moduleInfo: ModuleAnalysisResult = {
                name: "test-module",
                modulePath: "/test/path",
                language: "javascript",
                framework: "express",
            };

            const result = await service.generateDockerfile("/test/path", moduleInfo);

            // Should fail because Language Model is not available in test environment
            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(
                result.error.includes("Language Model") ||
                    result.error.includes("Failed to") ||
                    result.error.includes("Copilot"),
            );
        });

        it("generateManifests returns error when Language Model not available", async () => {
            const service = new ContainerAssistService();

            const moduleInfo: ModuleAnalysisResult = {
                name: "test-module",
                modulePath: "/test/path",
            };

            const result = await service.generateManifests("/test/path", "test-app", moduleInfo);

            // Should fail because Language Model is not available in test environment
            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(
                result.error.includes("Language Model") ||
                    result.error.includes("Failed to") ||
                    result.error.includes("Copilot"),
            );
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
                result: {
                    modules: [{ name: "test", modulePath: "/test/path", language: "javascript" }],
                    isMonorepo: false,
                },
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

        it("checkExistingFiles returns empty result when no files exist", async () => {
            const service = new ContainerAssistService();

            // Stub vscode.workspace.fs.stat to throw (file not found)
            const statStub = sandbox.stub(vscode.workspace.fs, "stat").rejects(new Error("File not found"));

            const result = await service.checkExistingFiles("/test/path");

            assert.strictEqual(result.hasDockerfile, false);
            assert.strictEqual(result.hasK8sManifests, false);
            assert.strictEqual(result.dockerfilePath, undefined);
            assert.strictEqual(result.k8sManifestPaths, undefined);

            statStub.restore();
        });

        it("checkExistingFiles detects Dockerfile when present", async () => {
            const service = new ContainerAssistService();

            // Stub stat to succeed for Dockerfile, fail for k8s folder
            const statStub = sandbox.stub(vscode.workspace.fs, "stat").callsFake((uri) => {
                if (uri.fsPath.endsWith("Dockerfile")) {
                    return Promise.resolve({ type: vscode.FileType.File } as vscode.FileStat);
                }
                return Promise.reject(new Error("Not found"));
            });

            const result = await service.checkExistingFiles("/test/path");

            assert.strictEqual(result.hasDockerfile, true);
            assert.strictEqual(result.dockerfilePath, "/test/path/Dockerfile");
            assert.strictEqual(result.hasK8sManifests, false);

            statStub.restore();
        });

        it("checkExistingFiles detects K8s manifests when present", async () => {
            const service = new ContainerAssistService();

            // Stub stat and readDirectory for k8s folder with YAML files
            const statStub = sandbox.stub(vscode.workspace.fs, "stat").callsFake((uri) => {
                if (uri.fsPath.endsWith("k8s")) {
                    return Promise.resolve({ type: vscode.FileType.Directory } as vscode.FileStat);
                }
                return Promise.reject(new Error("Not found"));
            });

            const readDirStub = sandbox.stub(vscode.workspace.fs, "readDirectory").resolves([
                ["deployment.yaml", vscode.FileType.File],
                ["service.yaml", vscode.FileType.File],
                ["README.md", vscode.FileType.File],
            ]);

            const result = await service.checkExistingFiles("/test/path");

            assert.strictEqual(result.hasDockerfile, false);
            assert.strictEqual(result.hasK8sManifests, true);
            assert.ok(result.k8sManifestPaths);
            assert.strictEqual(result.k8sManifestPaths.length, 2);
            assert.ok(result.k8sManifestPaths.some((p) => p.includes("deployment.yaml")));
            assert.ok(result.k8sManifestPaths.some((p) => p.includes("service.yaml")));

            statStub.restore();
            readDirStub.restore();
        });

        it("generateDeploymentFiles prompts when existing files found", async () => {
            const service = new ContainerAssistService();

            // Stub checkExistingFiles to return existing files
            const checkStub = sandbox.stub(service, "checkExistingFiles").resolves({
                hasDockerfile: true,
                hasK8sManifests: false,
                dockerfilePath: "/test/path/Dockerfile",
            });

            // Stub warning message to simulate user cancelling
            const warningStub = sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("cancelled") || result.error.includes("not modified"));
            assert.ok(warningStub.calledOnce);

            checkStub.restore();
            warningStub.restore();
        });

        it("generateDeploymentFiles continues when user confirms overwrite", async () => {
            const service = new ContainerAssistService();

            // Stub checkExistingFiles to return existing files
            const checkStub = sandbox.stub(service, "checkExistingFiles").resolves({
                hasDockerfile: true,
                hasK8sManifests: false,
                dockerfilePath: "/test/path/Dockerfile",
            });

            // Stub warning message to simulate user confirming overwrite
            const warningStub = sandbox
                .stub(vscode.window, "showWarningMessage")
                .resolves("Overwrite" as unknown as vscode.MessageItem);

            // Stub subsequent steps to fail at LM availability
            const lmStub = sandbox.stub(service, "selectLanguageModel").resolves({
                succeeded: false,
                error: "No LM available",
            });

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            // Should fail at LM step, not at existing files step
            assert.strictEqual(result.succeeded, false);
            assert.strictEqual(result.error, "No LM available");
            assert.ok(warningStub.calledOnce);
            assert.ok(lmStub.calledOnce);

            checkStub.restore();
            warningStub.restore();
            lmStub.restore();
        });

        it("selectLanguageModel returns error when no models found", async () => {
            const service = new ContainerAssistService();

            // Stub lm.selectChatModels to return empty array
            const selectStub = sandbox.stub(vscode.lm, "selectChatModels").resolves([]);

            const result = await service.selectLanguageModel();

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("No Language Model") || result.error.includes("Copilot"));

            selectStub.restore();
        });

        it("selectLanguageModel returns first model when single model available", async () => {
            const service = new ContainerAssistService();

            const mockModel = {
                id: "test-model-id",
                name: "Test Model",
                vendor: "copilot",
                family: "gpt-4o",
            } as vscode.LanguageModelChat;

            // Stub lm.selectChatModels to return single model
            const selectStub = sandbox.stub(vscode.lm, "selectChatModels").resolves([mockModel]);

            const result = await service.selectLanguageModel(false);

            assert.strictEqual(result.succeeded, true);
            if (result.succeeded) {
                assert.strictEqual(result.result.id, "test-model-id");
            }

            selectStub.restore();
        });

        it("selectLanguageModel shows QuickPick when allowSelection true and multiple models", async () => {
            const service = new ContainerAssistService();

            const mockModels = [
                { id: "model-1", name: "Model 1", vendor: "copilot", family: "gpt-4o" },
                { id: "model-2", name: "Model 2", vendor: "copilot", family: "gpt-4" },
            ] as vscode.LanguageModelChat[];

            // Stub lm.selectChatModels to return multiple models
            const selectStub = sandbox.stub(vscode.lm, "selectChatModels").resolves(mockModels);

            // Stub showQuickPick to return the second model
            const quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves({
                label: "Model 2",
                model: mockModels[1],
            } as unknown as vscode.QuickPickItem);

            const result = await service.selectLanguageModel(true);

            assert.strictEqual(result.succeeded, true);
            if (result.succeeded) {
                assert.strictEqual(result.result.id, "model-2");
            }
            assert.ok(quickPickStub.calledOnce);

            selectStub.restore();
            quickPickStub.restore();
        });

        it("selectLanguageModel returns error when user cancels model selection", async () => {
            const service = new ContainerAssistService();

            const mockModels = [
                { id: "model-1", name: "Model 1", vendor: "copilot", family: "gpt-4o" },
                { id: "model-2", name: "Model 2", vendor: "copilot", family: "gpt-4" },
            ] as vscode.LanguageModelChat[];

            // Stub lm.selectChatModels to return multiple models
            const selectStub = sandbox.stub(vscode.lm, "selectChatModels").resolves(mockModels);

            // Stub showQuickPick to return undefined (cancelled)
            const quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);

            const result = await service.selectLanguageModel(true);

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("cancelled"));

            selectStub.restore();
            quickPickStub.restore();
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

            // analyzeRepository should handle SDK failures gracefully
            const result = await service.analyzeRepository("/nonexistent/path");

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error);
            assert.ok(result.error.includes("Failed to analyze repository") || result.error.length > 0);
        });

        it("service methods return Errorable pattern", async () => {
            const service = new ContainerAssistService();

            const analyzeResult = await service.analyzeRepository("/test");
            const moduleInfo: ModuleAnalysisResult = { name: "test", modulePath: "/test" };
            const dockerfileResult = await service.generateDockerfile("/test", moduleInfo);
            const manifestsResult = await service.generateManifests("/test", "app", moduleInfo);

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
