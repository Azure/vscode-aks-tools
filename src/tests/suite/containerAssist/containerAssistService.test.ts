import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { ContainerAssistService } from "../../../commands/aksContainerAssist/containerAssistService";
import { ModuleAnalysisResult } from "../../../commands/aksContainerAssist/types";

describe("ContainerAssistService", () => {
    let sandbox: sinon.SinonSandbox;
    let service: ContainerAssistService;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        service = new ContainerAssistService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe("isAvailable", () => {
        it("returns error when disabled", async () => {
            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(false),
            } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

            const result = await service.isAvailable();

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error?.includes("Container Assist is not enabled"));
        });

        it("returns success when enabled", async () => {
            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(true),
            } as Partial<vscode.WorkspaceConfiguration> as vscode.WorkspaceConfiguration);

            const result = await service.isAvailable();

            assert.strictEqual(result.succeeded, true);
        });
    });

    describe("analyzeRepository", () => {
        it("returns error when SDK fails", async () => {
            const result = await service.analyzeRepository("/test/path");

            assert.strictEqual(result.succeeded, false);
            // SDK returns error about knowledge base, not "Failed to" message
            assert.ok(result.error);
        });
    });

    describe("generateDockerfile", () => {
        it("returns error when LM not available", async () => {
            const moduleInfo: ModuleAnalysisResult = {
                name: "test-module",
                modulePath: "/test/path",
                language: "javascript",
                framework: "express",
            };

            const result = await service.generateDockerfile("/test/path", moduleInfo);

            assert.strictEqual(result.succeeded, false);
            assert.ok(
                result.error?.includes("Language Model") ||
                    result.error?.includes("Failed to") ||
                    result.error?.includes("Copilot"),
            );
        });
    });

    describe("generateManifests", () => {
        it("returns error when LM not available", async () => {
            const moduleInfo: ModuleAnalysisResult = {
                name: "test-module",
                modulePath: "/test/path",
            };

            const result = await service.generateManifests("/test/path", "test-app", moduleInfo);

            assert.strictEqual(result.succeeded, false);
            assert.ok(
                result.error?.includes("Language Model") ||
                    result.error?.includes("Failed to") ||
                    result.error?.includes("Copilot"),
            );
        });
    });

    describe("selectLanguageModel", () => {
        it("returns error when no models found", async () => {
            sandbox.stub(vscode.lm, "selectChatModels").resolves([]);

            const result = await service.selectLanguageModel();

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error?.includes("No Language Model") || result.error?.includes("Copilot"));
        });

        it("returns model when available", async () => {
            const mockModel = {
                id: "test-model-id",
                name: "Test Model",
                vendor: "copilot",
                family: "gpt-4o",
            } as vscode.LanguageModelChat;
            sandbox.stub(vscode.lm, "selectChatModels").resolves([mockModel]);

            const result = await service.selectLanguageModel(false);

            assert.strictEqual(result.succeeded, true);
            if (result.succeeded) {
                assert.strictEqual(result.result.id, "test-model-id");
            }
        });

        it("shows QuickPick for multiple models", async () => {
            const mockModels = [
                { id: "model-1", name: "Model 1", vendor: "copilot", family: "gpt-4o" },
                { id: "model-2", name: "Model 2", vendor: "copilot", family: "gpt-4" },
            ] as vscode.LanguageModelChat[];
            sandbox.stub(vscode.lm, "selectChatModels").resolves(mockModels);
            sandbox.stub(vscode.window, "showQuickPick").resolves({
                label: "Model 2",
                model: mockModels[1],
            } as unknown as vscode.QuickPickItem);

            const result = await service.selectLanguageModel(true);

            assert.strictEqual(result.succeeded, true);
            if (result.succeeded) {
                assert.strictEqual(result.result.id, "model-2");
            }
        });

        it("returns error on cancelled selection", async () => {
            const mockModels = [
                { id: "model-1", name: "Model 1", vendor: "copilot", family: "gpt-4o" },
                { id: "model-2", name: "Model 2", vendor: "copilot", family: "gpt-4" },
            ] as vscode.LanguageModelChat[];
            sandbox.stub(vscode.lm, "selectChatModels").resolves(mockModels);
            sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);

            const result = await service.selectLanguageModel(true);

            assert.strictEqual(result.succeeded, false);
            assert.ok(result.error?.includes("cancelled"));
        });
    });

    describe("generateDeploymentFiles workflow", () => {
        it("returns success when all files exist", async () => {
            sandbox.stub(service, "checkExistingFiles").resolves({
                hasDockerfile: true,
                hasK8sManifests: true,
                dockerfilePath: "/test/path/Dockerfile",
                k8sManifestPaths: ["/test/path/k8s/deployment.yaml"],
            });
            const infoStub = sandbox.stub(vscode.window, "showInformationMessage");

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, true);
            if (result.succeeded) {
                assert.strictEqual(result.result.generatedFiles.length, 0);
            }
            assert.ok(infoStub.calledOnce);
        });

        it("preserves existing files and generates missing ones", async () => {
            sandbox.stub(service, "checkExistingFiles").resolves({
                hasDockerfile: true,
                hasK8sManifests: false,
                dockerfilePath: "/test/path/Dockerfile",
            });
            const infoStub = sandbox.stub(vscode.window, "showInformationMessage");
            const mockModel = {
                id: "test",
                name: "Test",
                vendor: "copilot",
                family: "gpt-4o",
            } as vscode.LanguageModelChat;
            sandbox.stub(service, "selectLanguageModel").resolves({ succeeded: true, result: mockModel });
            sandbox.stub(service, "analyzeRepository").resolves({
                succeeded: true,
                result: {
                    modules: [{ name: "test", modulePath: "/test/path", language: "javascript" }],
                    isMonorepo: false,
                },
            });
            const dockerfileStub = sandbox.stub(service, "generateDockerfile");
            sandbox.stub(service, "generateManifests").resolves({
                succeeded: true,
                result: ["/test/path/k8s/deployment.yaml"],
            });

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, true);
            assert.ok(infoStub.calledOnce);
            assert.ok(infoStub.firstCall.args[0].includes("preserved"));
            assert.ok(dockerfileStub.notCalled, "Dockerfile generation should be skipped");
        });

        it("stops on LM unavailable", async () => {
            sandbox.stub(service, "checkExistingFiles").resolves({
                hasDockerfile: false,
                hasK8sManifests: false,
            });
            sandbox.stub(service, "selectLanguageModel").resolves({
                succeeded: false,
                error: "No LM available",
            });
            const analyzeStub = sandbox.stub(service, "analyzeRepository");

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, false);
            assert.strictEqual(result.error, "No LM available");
            assert.ok(analyzeStub.notCalled);
        });

        it("stops on analysis failure", async () => {
            sandbox.stub(service, "checkExistingFiles").resolves({
                hasDockerfile: false,
                hasK8sManifests: false,
            });
            const mockModel = {
                id: "test",
                name: "Test",
                vendor: "copilot",
                family: "gpt-4o",
            } as vscode.LanguageModelChat;
            sandbox.stub(service, "selectLanguageModel").resolves({ succeeded: true, result: mockModel });
            const analyzeStub = sandbox.stub(service, "analyzeRepository").resolves({
                succeeded: false,
                error: "Analysis failed",
            });
            const dockerfileStub = sandbox.stub(service, "generateDockerfile");

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, false);
            assert.strictEqual(result.error, "Analysis failed");
            assert.ok(analyzeStub.calledOnce);
            assert.ok(dockerfileStub.notCalled);
        });

        it("stops on dockerfile failure", async () => {
            sandbox.stub(service, "checkExistingFiles").resolves({
                hasDockerfile: false,
                hasK8sManifests: false,
            });
            const mockModel = {
                id: "test",
                name: "Test",
                vendor: "copilot",
                family: "gpt-4o",
            } as vscode.LanguageModelChat;
            sandbox.stub(service, "selectLanguageModel").resolves({ succeeded: true, result: mockModel });
            sandbox.stub(service, "analyzeRepository").resolves({
                succeeded: true,
                result: {
                    modules: [{ name: "test", modulePath: "/test/path", language: "javascript" }],
                    isMonorepo: false,
                },
            });
            sandbox.stub(service, "generateDockerfile").resolves({
                succeeded: false,
                error: "Dockerfile generation failed",
            });
            const manifestsStub = sandbox.stub(service, "generateManifests");

            const result = await service.generateDeploymentFiles("/test/path", "test-app");

            assert.strictEqual(result.succeeded, false);
            assert.strictEqual(result.error, "Dockerfile generation failed");
            assert.ok(manifestsStub.notCalled);
        });
    });
});
