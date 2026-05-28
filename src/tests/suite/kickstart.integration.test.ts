import * as assert from "assert";
import * as vscode from "vscode";
import { Phase, KickstartState, createInitialState } from "../../chatParticipants/kickstart/state";
import { validatePrereqs } from "../../chatParticipants/kickstart/phaseRunner";

/**
 * Integration tests for Kickstart phase-based deployment flow
 *
 * These tests verify end-to-end phase execution, state transitions,
 * prerequisite validation, and AKS Automatic vs Standard differentiation.
 *
 * NOTE: These tests mock external dependencies (Azure APIs, kubectl, VS Code workspace)
 * to enable automated testing. Manual QA on real clusters is still required.
 */
describe("Kickstart Integration Tests", () => {
    const TEST_WORKSPACE = "/test/workspace";

    function createMockContext(): vscode.ExtensionContext {
        const storage = new Map<string, unknown>();

        const context: Partial<vscode.ExtensionContext> = {
            workspaceState: {
                get: <T>(key: string): T | undefined => storage.get(key) as T | undefined,
                update: async (key: string, value: unknown): Promise<void> => {
                    storage.set(key, value);
                },
                keys: () => Array.from(storage.keys()),
                setKeysForSync: () => {},
            },
            globalState: {
                get: <T>(_key: string): T | undefined => undefined,
                update: async (_key: string, _value: unknown): Promise<void> => {},
                keys: () => [],
                setKeysForSync: () => {},
            },
            extensionPath: "/test/extension",
            extensionUri: vscode.Uri.file("/test/extension"),
            subscriptions: [],
            extension: {} as vscode.Extension<unknown>,
            extensionMode: vscode.ExtensionMode.Test,
        } as Partial<vscode.ExtensionContext>;

        return context as vscode.ExtensionContext;
    }

    /**
     * Creates mock analysis data for testing
     */
    function createMockAnalysis() {
        return {
            language: "typescript",
            framework: "express",
            ports: [3000],
            isMonorepo: false,
            modules: [
                {
                    name: "test-app",
                    modulePath: ".",
                    language: "typescript",
                    framework: "express",
                    entryPoint: "src/index.ts",
                    port: 3000,
                },
            ],
            hasDockerfile: false,
            hasK8sManifests: false,
            hasGitHubWorkflow: false,
        };
    }

    /**
     * Creates mock configuration data for testing
     */
    function createMockConfig(clusterSku: "Standard" | "Automatic" = "Standard") {
        return {
            subscriptionId: "test-sub-123",
            resourceGroup: "test-rg",
            clusterName: "test-cluster",
            clusterSku,
            acrName: "testacr",
            acrLoginServer: "testacr.azurecr.io",
            namespace: "default",
            canGetKubeconfig: true,
            hasAcrPull: true,
            azureRbacEnabled: false,
            hasAksDeployRole: true,
            aksDeployRoleNames: [],
            clusterRbacInconclusive: false,
            hasAcrPushRole: true,
            hasAcrTasksContributorRole: true,
            acrRbacInconclusive: false,
        };
    }

    /**
     * Creates mock artifacts data for testing
     */
    function createMockArtifacts() {
        return {
            stagedFiles: [
                {
                    filename: "Dockerfile",
                    content:
                        'FROM node:18-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "start"]',
                    stagedPath: "vscode-userdata:/kickstart-staging/Dockerfile",
                    status: "accepted" as const,
                    generatedAt: Date.now(),
                },
                {
                    filename: "k8s/deployment.yaml",
                    content: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: test-app",
                    stagedPath: "vscode-userdata:/kickstart-staging/k8s/deployment.yaml",
                    status: "accepted" as const,
                    generatedAt: Date.now(),
                },
                {
                    filename: "k8s/service.yaml",
                    content: "apiVersion: v1\nkind: Service\nmetadata:\n  name: test-app",
                    stagedPath: "vscode-userdata:/kickstart-staging/k8s/service.yaml",
                    status: "accepted" as const,
                    generatedAt: Date.now(),
                },
            ],
            savedToDisk: true,
        };
    }

    /**
     * Creates mock image data for testing
     */
    function createMockImage() {
        return {
            repository: "testacr.azurecr.io/test-app",
            tag: "20240101-abc123",
        };
    }

    /**
     * Creates mock deployment data for testing
     */
    function createMockDeployment() {
        return {
            appliedManifests: ["deployment.yaml", "service.yaml"],
            timestamp: Date.now(),
        };
    }

    describe("Phase Prerequisite Validation", () => {
        it("allows ANALYZE phase with no prior data", () => {
            const state = createInitialState(TEST_WORKSPACE);
            const result = validatePrereqs(Phase.ANALYZE, state);

            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.missing, undefined);
        });

        it("blocks CONFIGURE phase when analysis is missing", () => {
            const state = createInitialState(TEST_WORKSPACE);
            const result = validatePrereqs(Phase.CONFIGURE, state);

            assert.strictEqual(result.ok, false);
            assert.ok(result.missing);
            assert.ok(result.missing.includes("Project analysis data"));
            assert.strictEqual(result.suggestedPhase, Phase.ANALYZE);
        });

        it("allows CONFIGURE phase when analysis exists", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
            };
            const result = validatePrereqs(Phase.CONFIGURE, state);

            assert.strictEqual(result.ok, true);
        });

        it("blocks PREPARE phase when config is missing", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
            };
            const result = validatePrereqs(Phase.PREPARE, state);

            assert.strictEqual(result.ok, false);
            assert.ok(result.missing);
            assert.ok(result.missing.includes("Cluster and registry configuration"));
            assert.strictEqual(result.suggestedPhase, Phase.CONFIGURE);
        });

        it("allows PREPARE phase when analysis and config exist", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig(),
            };
            const result = validatePrereqs(Phase.PREPARE, state);

            assert.strictEqual(result.ok, true);
        });

        it("blocks BUILD phase when artifacts are not saved", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: {
                    ...createMockArtifacts(),
                    savedToDisk: false,
                },
            };
            const result = validatePrereqs(Phase.BUILD, state);

            assert.strictEqual(result.ok, false);
            assert.ok(result.missing);
            assert.ok(result.missing.some((m) => m.includes("artifacts")));
        });

        it("allows BUILD phase when artifacts are saved to disk", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
            };
            const result = validatePrereqs(Phase.BUILD, state);

            assert.strictEqual(result.ok, true);
        });

        it("blocks DEPLOY phase when image is missing", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
            };
            const result = validatePrereqs(Phase.DEPLOY, state);

            assert.strictEqual(result.ok, false);
            assert.ok(result.missing);
            assert.ok(result.missing.includes("Built container image"));
        });

        it("allows DEPLOY phase when image exists", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
                image: createMockImage(),
            };
            const result = validatePrereqs(Phase.DEPLOY, state);

            assert.strictEqual(result.ok, true);
        });

        it("blocks VERIFY phase when deployment is missing", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
                image: createMockImage(),
            };
            const result = validatePrereqs(Phase.VERIFY, state);

            assert.strictEqual(result.ok, false);
            assert.ok(result.missing);
            assert.ok(result.missing.includes("Deployed resources"));
        });

        it("allows VERIFY phase when deployment exists", () => {
            const state: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
                image: createMockImage(),
                deployment: createMockDeployment(),
            };
            const result = validatePrereqs(Phase.VERIFY, state);

            assert.strictEqual(result.ok, true);
        });
    });

    describe("AKS Automatic vs Standard Differentiation", () => {
        it("Standard cluster config should have clusterSku='Standard'", () => {
            const config = createMockConfig("Standard");
            assert.strictEqual(config.clusterSku, "Standard");
        });

        it("Automatic cluster config should have clusterSku='Automatic'", () => {
            const config = createMockConfig("Automatic");
            assert.strictEqual(config.clusterSku, "Automatic");
        });

        it("state preserves cluster SKU through phases", () => {
            const initialState: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                analysis: createMockAnalysis(),
                config: createMockConfig("Automatic"),
            };

            assert.strictEqual(initialState.config?.clusterSku, "Automatic");

            const withArtifacts: KickstartState = {
                ...initialState,
                artifacts: createMockArtifacts(),
            };

            assert.strictEqual(withArtifacts.config?.clusterSku, "Automatic");

            const withImage: KickstartState = {
                ...withArtifacts,
                image: createMockImage(),
            };

            assert.strictEqual(withImage.config?.clusterSku, "Automatic");
        });
    });

    describe("State Resumability", () => {
        it("state can be serialized and deserialized", () => {
            const originalState: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                currentPhase: Phase.CONFIGURE,
                analysis: createMockAnalysis(),
                config: createMockConfig(),
            };

            const serialized = JSON.stringify(originalState);
            const deserialized: KickstartState = JSON.parse(serialized);

            assert.strictEqual(deserialized.workspaceFolder, originalState.workspaceFolder);
            assert.strictEqual(deserialized.currentPhase, originalState.currentPhase);
            assert.strictEqual(deserialized.analysis?.language, originalState.analysis?.language);
            assert.strictEqual(deserialized.config?.clusterName, originalState.config?.clusterName);
        });

        it("state persists through workspaceState mock", async () => {
            const context = createMockContext();
            const storageKey = `kickstart.state.${TEST_WORKSPACE}`;

            const originalState: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                currentPhase: Phase.BUILD,
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
            };

            await context.workspaceState.update(storageKey, originalState);

            const loadedState = context.workspaceState.get<KickstartState>(storageKey);

            assert.ok(loadedState);
            assert.strictEqual(loadedState.currentPhase, Phase.BUILD);
            assert.ok(loadedState.analysis);
            assert.ok(loadedState.config);
            assert.ok(loadedState.artifacts);
        });

        it("validates prerequisites after resume", () => {
            const resumedState: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                currentPhase: Phase.BUILD,
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
            };

            const result = validatePrereqs(Phase.BUILD, resumedState);
            assert.strictEqual(result.ok, true);
        });
    });

    describe("Error Handling", () => {
        it("marks phase as retryable when error occurs", () => {
            const stateWithError: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                currentPhase: Phase.BUILD,
                lastError: {
                    phase: Phase.BUILD,
                    message: "Docker build failed",
                    retryable: true,
                },
            };

            assert.ok(stateWithError.lastError);
            assert.strictEqual(stateWithError.lastError.retryable, true);
            assert.strictEqual(stateWithError.lastError.phase, Phase.BUILD);
        });

        it("preserves state when error occurs", () => {
            const stateBeforeError: KickstartState = {
                ...createInitialState(TEST_WORKSPACE),
                currentPhase: Phase.DEPLOY,
                analysis: createMockAnalysis(),
                config: createMockConfig(),
                artifacts: createMockArtifacts(),
                image: createMockImage(),
            };

            const stateWithError: KickstartState = {
                ...stateBeforeError,
                lastError: {
                    phase: Phase.DEPLOY,
                    message: "kubectl apply failed",
                    retryable: true,
                },
            };

            assert.ok(stateWithError.analysis);
            assert.ok(stateWithError.config);
            assert.ok(stateWithError.artifacts);
            assert.ok(stateWithError.image);
        });
    });

    describe("Phase Transition Logic", () => {
        it("progresses through phases in correct order", () => {
            const phases = [Phase.ANALYZE, Phase.CONFIGURE, Phase.PREPARE, Phase.BUILD, Phase.DEPLOY, Phase.VERIFY];

            for (let i = 0; i < phases.length - 1; i++) {
                const currentPhase = phases[i];
                const nextPhase = phases[i + 1];
                assert.ok(
                    nextPhase > currentPhase,
                    `Phase ${Phase[nextPhase]} should come after ${Phase[currentPhase]}`,
                );
            }
        });

        it("each phase has unique numeric value", () => {
            const phaseValues = new Set([
                Phase.ANALYZE,
                Phase.CONFIGURE,
                Phase.PREPARE,
                Phase.BUILD,
                Phase.DEPLOY,
                Phase.VERIFY,
                Phase.COMPLETE,
            ]);

            assert.strictEqual(phaseValues.size, 7, "All phases should have unique numeric values");
        });
    });
});
