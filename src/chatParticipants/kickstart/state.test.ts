import * as assert from "assert";
import { Phase, createInitialState, jumpToPhase } from "./state";

describe("kickstart state", () => {
    describe("Phase enum", () => {
        it("ANALYZE should be 0", () => {
            assert.strictEqual(Phase.ANALYZE, 0);
        });

        it("CONFIGURE should be 1", () => {
            assert.strictEqual(Phase.CONFIGURE, 1);
        });

        it("PREPARE should be 2", () => {
            assert.strictEqual(Phase.PREPARE, 2);
        });

        it("BUILD should be 3", () => {
            assert.strictEqual(Phase.BUILD, 3);
        });

        it("DEPLOY should be 4", () => {
            assert.strictEqual(Phase.DEPLOY, 4);
        });

        it("VERIFY should be 5", () => {
            assert.strictEqual(Phase.VERIFY, 5);
        });

        it("COMPLETE should be 6", () => {
            assert.strictEqual(Phase.COMPLETE, 6);
        });

        it("all phases are ordered 0-6", () => {
            const phases = [
                Phase.ANALYZE,
                Phase.CONFIGURE,
                Phase.PREPARE,
                Phase.BUILD,
                Phase.DEPLOY,
                Phase.VERIFY,
                Phase.COMPLETE,
            ];

            for (let i = 0; i < phases.length; i++) {
                assert.strictEqual(phases[i], i, `Phase at index ${i} should equal ${i}`);
            }
        });
    });

    describe("createInitialState()", () => {
        it("returns a state with Phase.ANALYZE as currentPhase", () => {
            const workspaceFolder = "/path/to/workspace";
            const state = createInitialState(workspaceFolder);

            assert.strictEqual(state.currentPhase, Phase.ANALYZE);
        });

        it("returns a state with the correct workspaceFolder", () => {
            const workspaceFolder = "/path/to/workspace";
            const state = createInitialState(workspaceFolder);

            assert.strictEqual(state.workspaceFolder, workspaceFolder);
        });

        it("returns a state with no optional data fields set", () => {
            const workspaceFolder = "/path/to/workspace";
            const state = createInitialState(workspaceFolder);

            assert.strictEqual(state.analysis, undefined);
            assert.strictEqual(state.config, undefined);
            assert.strictEqual(state.artifacts, undefined);
            assert.strictEqual(state.image, undefined);
            assert.strictEqual(state.deployment, undefined);
            assert.strictEqual(state.verification, undefined);
            assert.strictEqual(state.lastError, undefined);
        });

        it("works with different workspace folder paths", () => {
            const paths = ["/home/user/project", "/Users/developer/workspace", "C:\\Users\\dev\\app"];

            paths.forEach((path) => {
                const state = createInitialState(path);
                assert.strictEqual(state.workspaceFolder, path);
                assert.strictEqual(state.currentPhase, Phase.ANALYZE);
            });
        });
    });

    describe("jumpToPhase()", () => {
        it("changes the currentPhase to the target phase", () => {
            const initialState = createInitialState("/workspace");
            const newState = jumpToPhase(Phase.CONFIGURE, initialState);

            assert.strictEqual(newState.currentPhase, Phase.CONFIGURE);
        });

        it("preserves workspaceFolder when jumping to a phase", () => {
            const initialState = createInitialState("/workspace");
            const newState = jumpToPhase(Phase.DEPLOY, initialState);

            assert.strictEqual(newState.workspaceFolder, "/workspace");
        });

        it("clears all error info when jumping to any phase", () => {
            const stateWithError = {
                ...createInitialState("/workspace"),
                lastError: {
                    phase: Phase.ANALYZE,
                    message: "Test error",
                    retryable: true,
                },
            };

            const newState = jumpToPhase(Phase.CONFIGURE, stateWithError);

            assert.strictEqual(newState.lastError, undefined);
        });

        describe("backward phase jumps", () => {
            it("jumping to ANALYZE clears analysis data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.CONFIGURE,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                };

                const newState = jumpToPhase(Phase.ANALYZE, stateWithData);

                assert.strictEqual(newState.analysis, undefined);
            });

            it("jumping to CONFIGURE clears config and later data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.DEPLOY,
                    config: {
                        subscriptionId: "sub-123",
                        resourceGroup: "rg-test",
                        clusterName: "cluster-1",
                        clusterSku: "Standard" as const,
                        acrName: "acr-test",
                        acrLoginServer: "acr-test.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                        azureRbacEnabled: false,
                        hasAksDeployRole: true,
                        aksDeployRoleNames: [],
                        clusterRbacInconclusive: false,
                        hasAcrPushRole: true,
                        hasAcrTasksContributorRole: true,
                        acrRbacInconclusive: false,
                    },
                    artifacts: { stagedFiles: [], savedToDisk: false },
                    image: { repository: "acr.azurecr.io/app", tag: "v1" },
                    deployment: { appliedManifests: ["manifest.yaml"], timestamp: Date.now() },
                };

                const newState = jumpToPhase(Phase.CONFIGURE, stateWithData);

                assert.strictEqual(newState.config, undefined);
                assert.strictEqual(newState.artifacts, undefined);
                assert.strictEqual(newState.image, undefined);
                assert.strictEqual(newState.deployment, undefined);
            });

            it("jumping to PREPARE clears artifacts and later data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.DEPLOY,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                    config: {
                        subscriptionId: "sub-123",
                        resourceGroup: "rg-test",
                        clusterName: "cluster-1",
                        clusterSku: "Standard" as const,
                        acrName: "acr-test",
                        acrLoginServer: "acr-test.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                        azureRbacEnabled: false,
                        hasAksDeployRole: true,
                        aksDeployRoleNames: [],
                        clusterRbacInconclusive: false,
                        hasAcrPushRole: true,
                        hasAcrTasksContributorRole: true,
                        acrRbacInconclusive: false,
                    },
                    artifacts: { stagedFiles: [], savedToDisk: true },
                    image: { repository: "acr.azurecr.io/app", tag: "v1" },
                    deployment: { appliedManifests: ["manifest.yaml"], timestamp: Date.now() },
                };

                const newState = jumpToPhase(Phase.PREPARE, stateWithData);

                assert.ok(newState.analysis);
                assert.ok(newState.config);
                assert.strictEqual(newState.artifacts, undefined);
                assert.strictEqual(newState.image, undefined);
                assert.strictEqual(newState.deployment, undefined);
            });

            it("jumping to BUILD clears image and later data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.COMPLETE,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                    config: {
                        subscriptionId: "sub-123",
                        resourceGroup: "rg-test",
                        clusterName: "cluster-1",
                        clusterSku: "Standard" as const,
                        acrName: "acr-test",
                        acrLoginServer: "acr-test.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                        azureRbacEnabled: false,
                        hasAksDeployRole: true,
                        aksDeployRoleNames: [],
                        clusterRbacInconclusive: false,
                        hasAcrPushRole: true,
                        hasAcrTasksContributorRole: true,
                        acrRbacInconclusive: false,
                    },
                    artifacts: { stagedFiles: [], savedToDisk: true },
                    image: { repository: "acr.azurecr.io/app", tag: "v1" },
                    deployment: { appliedManifests: ["manifest.yaml"], timestamp: Date.now() },
                    verification: { podsReady: true, serviceEndpoint: "http://localhost" },
                };

                const newState = jumpToPhase(Phase.BUILD, stateWithData);

                assert.ok(newState.analysis);
                assert.ok(newState.config);
                assert.ok(newState.artifacts);
                assert.strictEqual(newState.image, undefined);
                assert.strictEqual(newState.deployment, undefined);
                assert.strictEqual(newState.verification, undefined);
            });

            it("jumping to DEPLOY clears deployment and later data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.COMPLETE,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                    config: {
                        subscriptionId: "sub-123",
                        resourceGroup: "rg-test",
                        clusterName: "cluster-1",
                        clusterSku: "Standard" as const,
                        acrName: "acr-test",
                        acrLoginServer: "acr-test.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                        azureRbacEnabled: false,
                        hasAksDeployRole: true,
                        aksDeployRoleNames: [],
                        clusterRbacInconclusive: false,
                        hasAcrPushRole: true,
                        hasAcrTasksContributorRole: true,
                        acrRbacInconclusive: false,
                    },
                    artifacts: { stagedFiles: [], savedToDisk: true },
                    image: { repository: "acr.azurecr.io/app", tag: "v1" },
                    deployment: { appliedManifests: ["manifest.yaml"], timestamp: Date.now() },
                    verification: { podsReady: true, serviceEndpoint: "http://localhost" },
                };

                const newState = jumpToPhase(Phase.DEPLOY, stateWithData);

                assert.ok(newState.analysis);
                assert.ok(newState.config);
                assert.ok(newState.artifacts);
                assert.ok(newState.image);
                assert.strictEqual(newState.deployment, undefined);
                assert.strictEqual(newState.verification, undefined);
            });

            it("jumping to VERIFY clears verification data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.COMPLETE,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                    config: {
                        subscriptionId: "sub-123",
                        resourceGroup: "rg-test",
                        clusterName: "cluster-1",
                        clusterSku: "Standard" as const,
                        acrName: "acr-test",
                        acrLoginServer: "acr-test.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                        azureRbacEnabled: false,
                        hasAksDeployRole: true,
                        aksDeployRoleNames: [],
                        clusterRbacInconclusive: false,
                        hasAcrPushRole: true,
                        hasAcrTasksContributorRole: true,
                        acrRbacInconclusive: false,
                    },
                    artifacts: { stagedFiles: [], savedToDisk: true },
                    image: { repository: "acr.azurecr.io/app", tag: "v1" },
                    deployment: { appliedManifests: ["manifest.yaml"], timestamp: Date.now() },
                    verification: { podsReady: true, serviceEndpoint: "http://localhost" },
                };

                const newState = jumpToPhase(Phase.VERIFY, stateWithData);

                assert.ok(newState.analysis);
                assert.ok(newState.config);
                assert.ok(newState.artifacts);
                assert.ok(newState.image);
                assert.ok(newState.deployment);
                assert.strictEqual(newState.verification, undefined);
            });
        });

        describe("forward phase jumps", () => {
            it("jumping forward preserves earlier phase data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.ANALYZE,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                };

                const newState = jumpToPhase(Phase.DEPLOY, stateWithData);

                assert.ok(newState.analysis);
                assert.strictEqual(newState.analysis.language, "typescript");
            });

            it("jumping from ANALYZE to COMPLETE preserves all earlier data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.ANALYZE,
                    analysis: {
                        language: "python",
                        framework: "django",
                        ports: [8000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: true,
                        hasK8sManifests: true,
                        hasGitHubWorkflow: true,
                    },
                    config: {
                        subscriptionId: "sub-123",
                        resourceGroup: "rg-test",
                        clusterName: "cluster-1",
                        clusterSku: "Standard" as const,
                        acrName: "acr-test",
                        acrLoginServer: "acr-test.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                        azureRbacEnabled: false,
                        hasAksDeployRole: true,
                        aksDeployRoleNames: [],
                        clusterRbacInconclusive: false,
                        hasAcrPushRole: true,
                        hasAcrTasksContributorRole: true,
                        acrRbacInconclusive: false,
                    },
                    artifacts: {
                        stagedFiles: [
                            {
                                filename: "Dockerfile",
                                content: "FROM python:3.11",
                                stagedPath: "/tmp/Dockerfile",
                                status: "accepted" as const,
                                generatedAt: 0,
                            },
                        ],
                        savedToDisk: true,
                    },
                };

                const newState = jumpToPhase(Phase.COMPLETE, stateWithData);

                assert.ok(newState.analysis);
                assert.ok(newState.config);
                assert.ok(newState.artifacts);
                assert.strictEqual(newState.analysis.language, "python");
                assert.strictEqual(newState.config.clusterName, "cluster-1");
                assert.strictEqual(newState.artifacts.stagedFiles[0].content, "FROM python:3.11");
            });
        });

        describe("state immutability", () => {
            it("does not mutate the original state", () => {
                const originalState = createInitialState("/workspace");
                const originalPhase = originalState.currentPhase;

                jumpToPhase(Phase.CONFIGURE, originalState);

                assert.strictEqual(originalState.currentPhase, originalPhase);
            });

            it("returns a new state object", () => {
                const originalState = createInitialState("/workspace");
                const newState = jumpToPhase(Phase.BUILD, originalState);

                assert.notStrictEqual(newState, originalState);
            });

            it("preserves lastError when jumping forward", () => {
                const error = {
                    phase: Phase.ANALYZE,
                    message: "Analysis failed",
                    retryable: true,
                };

                const stateWithError = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.ANALYZE,
                    lastError: error,
                };

                const newState = jumpToPhase(Phase.CONFIGURE, stateWithError);
                assert.strictEqual(newState.lastError, undefined);
            });
        });

        describe("edge cases", () => {
            it("jumping to the same phase still clears downstream data", () => {
                const stateWithData = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.ANALYZE,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                };

                const newState = jumpToPhase(Phase.ANALYZE, stateWithData);

                assert.strictEqual(newState.currentPhase, Phase.ANALYZE);
                assert.strictEqual(newState.analysis, undefined);
            });

            it("handles state with partial data when jumping", () => {
                const partialState = {
                    ...createInitialState("/workspace"),
                    currentPhase: Phase.BUILD,
                    analysis: {
                        language: "typescript",
                        framework: "express",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                };

                const newState = jumpToPhase(Phase.PREPARE, partialState);

                assert.ok(newState.analysis);
                assert.strictEqual(newState.artifacts, undefined);
            });

            it("handles empty workspace folder string", () => {
                const state = createInitialState("");
                assert.strictEqual(state.workspaceFolder, "");
                assert.strictEqual(state.currentPhase, Phase.ANALYZE);
            });
        });
    });
});
