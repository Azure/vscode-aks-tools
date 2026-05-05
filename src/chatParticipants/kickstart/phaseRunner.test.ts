import * as assert from "assert";
import { Phase, KickstartState } from "./state";
import { validatePrereqs, classifyError } from "./phaseRunner";

describe("phaseRunner", () => {
    describe("validatePrereqs()", () => {
        describe("ANALYZE phase", () => {
            it("returns ok=true (no prerequisites required)", () => {
                const state: KickstartState = {
                    currentPhase: Phase.ANALYZE,
                    workspaceFolder: "/test/workspace",
                };

                const result = validatePrereqs(Phase.ANALYZE, state);

                assert.strictEqual(result.ok, true);
                assert.strictEqual(result.missing, undefined);
                assert.strictEqual(result.suggestedPhase, undefined);
            });

            it("returns ok=true even when no state data exists", () => {
                const state: KickstartState = {
                    currentPhase: Phase.ANALYZE,
                    workspaceFolder: "/test/workspace",
                };

                const result = validatePrereqs(Phase.ANALYZE, state);

                assert.strictEqual(result.ok, true);
            });
        });

        describe("CONFIGURE phase", () => {
            it("returns !ok when state.analysis is missing", () => {
                const state: KickstartState = {
                    currentPhase: Phase.CONFIGURE,
                    workspaceFolder: "/test/workspace",
                };

                const result = validatePrereqs(Phase.CONFIGURE, state);

                assert.strictEqual(result.ok, false);
                assert.ok(Array.isArray(result.missing));
                assert.ok(result.missing!.includes("Project analysis data"));
                assert.strictEqual(result.suggestedPhase, Phase.ANALYZE);
            });

            it("returns ok when state.analysis is present", () => {
                const state: KickstartState = {
                    currentPhase: Phase.CONFIGURE,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                };

                const result = validatePrereqs(Phase.CONFIGURE, state);

                assert.strictEqual(result.ok, true);
                assert.strictEqual(result.missing, undefined);
                assert.strictEqual(result.suggestedPhase, undefined);
            });
        });

        describe("PREPARE phase", () => {
            it("returns !ok when state.config is missing", () => {
                const state: KickstartState = {
                    currentPhase: Phase.PREPARE,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
                        ports: [3000],
                        isMonorepo: false,
                        modules: [],
                        hasDockerfile: false,
                        hasK8sManifests: false,
                        hasGitHubWorkflow: false,
                    },
                };

                const result = validatePrereqs(Phase.PREPARE, state);

                assert.strictEqual(result.ok, false);
                assert.ok(Array.isArray(result.missing));
                assert.ok(result.missing!.includes("Cluster and registry configuration"));
                assert.strictEqual(result.suggestedPhase, Phase.CONFIGURE);
            });

            it("returns ok when state.config is present", () => {
                const state: KickstartState = {
                    currentPhase: Phase.PREPARE,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                };

                const result = validatePrereqs(Phase.PREPARE, state);

                assert.strictEqual(result.ok, true);
                assert.strictEqual(result.missing, undefined);
                assert.strictEqual(result.suggestedPhase, undefined);
            });
        });

        describe("BUILD phase", () => {
            it("returns !ok when state.artifacts is missing", () => {
                const state: KickstartState = {
                    currentPhase: Phase.BUILD,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    // artifacts is missing
                };

                const result = validatePrereqs(Phase.BUILD, state);

                assert.strictEqual(result.ok, false);
                assert.ok(Array.isArray(result.missing));
                assert.ok(result.missing!.includes("Generated artifacts saved to disk"));
                assert.strictEqual(result.suggestedPhase, Phase.PREPARE);
            });

            it("returns !ok when state.artifacts.savedToDisk is false", () => {
                const state: KickstartState = {
                    currentPhase: Phase.BUILD,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18\nRUN npm install",
                        savedToDisk: false,
                    },
                };

                const result = validatePrereqs(Phase.BUILD, state);

                assert.strictEqual(result.ok, false);
                assert.ok(Array.isArray(result.missing));
                assert.ok(result.missing!.includes("Generated artifacts saved to disk"));
                assert.strictEqual(result.suggestedPhase, Phase.PREPARE);
            });

            it("returns ok when state.artifacts.savedToDisk is true", () => {
                const state: KickstartState = {
                    currentPhase: Phase.BUILD,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18\nRUN npm install",
                        manifests: [
                            {
                                filename: "deployment.yaml",
                                content: "apiVersion: v1\nkind: Deployment",
                            },
                        ],
                        savedToDisk: true,
                    },
                };

                const result = validatePrereqs(Phase.BUILD, state);

                assert.strictEqual(result.ok, true);
                assert.strictEqual(result.missing, undefined);
                assert.strictEqual(result.suggestedPhase, undefined);
            });
        });

        describe("DEPLOY phase", () => {
            it("returns !ok when state.image is missing", () => {
                const state: KickstartState = {
                    currentPhase: Phase.DEPLOY,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18",
                        savedToDisk: true,
                    },
                };

                const result = validatePrereqs(Phase.DEPLOY, state);

                assert.strictEqual(result.ok, false);
                assert.ok(Array.isArray(result.missing));
                assert.ok(result.missing!.includes("Built and pushed container image"));
                assert.strictEqual(result.suggestedPhase, Phase.BUILD);
            });

            it("returns ok when state.image is present", () => {
                const state: KickstartState = {
                    currentPhase: Phase.DEPLOY,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18",
                        savedToDisk: true,
                    },
                    image: {
                        repository: "testacr.azurecr.io/myapp",
                        tag: "latest",
                    },
                };

                const result = validatePrereqs(Phase.DEPLOY, state);

                assert.strictEqual(result.ok, true);
                assert.strictEqual(result.missing, undefined);
                assert.strictEqual(result.suggestedPhase, undefined);
            });
        });

        describe("VERIFY phase", () => {
            it("returns !ok when state.deployment is missing", () => {
                const state: KickstartState = {
                    currentPhase: Phase.VERIFY,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18",
                        savedToDisk: true,
                    },
                    image: {
                        repository: "testacr.azurecr.io/myapp",
                        tag: "latest",
                    },
                    // deployment is missing
                };

                const result = validatePrereqs(Phase.VERIFY, state);

                assert.strictEqual(result.ok, false);
                assert.ok(Array.isArray(result.missing));
                assert.ok(result.missing!.includes("Deployed manifests and tracking data"));
                assert.strictEqual(result.suggestedPhase, Phase.DEPLOY);
            });

            it("returns ok when state.deployment is present", () => {
                const state: KickstartState = {
                    currentPhase: Phase.VERIFY,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18",
                        savedToDisk: true,
                    },
                    image: {
                        repository: "testacr.azurecr.io/myapp",
                        tag: "latest",
                    },
                    deployment: {
                        appliedManifests: ["deployment.yaml"],
                        timestamp: Date.now(),
                    },
                };

                const result = validatePrereqs(Phase.VERIFY, state);

                assert.strictEqual(result.ok, true);
                assert.strictEqual(result.missing, undefined);
                assert.strictEqual(result.suggestedPhase, undefined);
            });
        });

        describe("COMPLETE phase", () => {
            it("returns !ok when state.verification is missing", () => {
                const state: KickstartState = {
                    currentPhase: Phase.COMPLETE,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18",
                        savedToDisk: true,
                    },
                    image: {
                        repository: "testacr.azurecr.io/myapp",
                        tag: "latest",
                    },
                    deployment: {
                        appliedManifests: ["deployment.yaml"],
                        timestamp: Date.now(),
                    },
                };

                const result = validatePrereqs(Phase.COMPLETE, state);

                assert.strictEqual(result.ok, false);
                assert.ok(Array.isArray(result.missing));
                assert.ok(result.missing!.includes("Verification results"));
                assert.strictEqual(result.suggestedPhase, Phase.VERIFY);
            });

            it("returns ok when state.verification is present", () => {
                const state: KickstartState = {
                    currentPhase: Phase.COMPLETE,
                    workspaceFolder: "/test/workspace",
                    analysis: {
                        language: "typescript",
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
                        clusterName: "aks-test",
                        clusterSku: "Standard",
                        acrName: "testacr",
                        acrLoginServer: "testacr.azurecr.io",
                        canGetKubeconfig: true,
                        hasAcrPull: true,
                    },
                    artifacts: {
                        dockerfile: "FROM node:18",
                        savedToDisk: true,
                    },
                    image: {
                        repository: "testacr.azurecr.io/myapp",
                        tag: "latest",
                    },
                    deployment: {
                        appliedManifests: ["deployment.yaml"],
                        timestamp: Date.now(),
                    },
                    verification: {
                        podsReady: true,
                        serviceEndpoint: "http://localhost:3000",
                    },
                };

                const result = validatePrereqs(Phase.COMPLETE, state);

                assert.strictEqual(result.ok, true);
                assert.strictEqual(result.missing, undefined);
                assert.strictEqual(result.suggestedPhase, undefined);
            });
        });
    });

    describe("classifyError()", () => {
        describe("Authentication errors", () => {
            it("classifies 'unauthorized' error as Authentication Required (retryable)", () => {
                const error = new Error("Unauthorized: Invalid credentials");

                const result = classifyError(error);

                assert.strictEqual(result.title, "Authentication Required");
                assert.strictEqual(result.retryable, true);
                assert.ok(result.detail.includes("az login"));
                assert.ok(result.fixCommand);
                assert.strictEqual(result.fixCommand.id, "az.login");
            });

            it("classifies 'authentication' error as Authentication Required (retryable)", () => {
                const error = "Authentication failed";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Authentication Required");
                assert.strictEqual(result.retryable, true);
            });

            it("classifies 'login' error as Authentication Required (retryable)", () => {
                const error = "Must login first";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Authentication Required");
                assert.strictEqual(result.retryable, true);
            });

            it("classifies 'unauthenticated' error as Authentication Required (retryable)", () => {
                const error = "Unauthenticated request";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Authentication Required");
                assert.strictEqual(result.retryable, true);
            });

            it("is case-insensitive for authentication keywords", () => {
                const error = "UNAUTHORIZED";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Authentication Required");
                assert.strictEqual(result.retryable, true);
            });
        });

        describe("Permission errors", () => {
            it("classifies 'forbidden' error as Insufficient Permissions (!retryable)", () => {
                const error = new Error("Forbidden: Access denied");

                const result = classifyError(error);

                assert.strictEqual(result.title, "Insufficient Permissions");
                assert.strictEqual(result.retryable, false);
                assert.ok(result.detail.includes("RBAC"));
            });

            it("classifies 'permission' error as Insufficient Permissions (!retryable)", () => {
                const error = "Permission denied on resource group";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Insufficient Permissions");
                assert.strictEqual(result.retryable, false);
            });

            it("classifies 'access denied' error as Insufficient Permissions (!retryable)", () => {
                const error = "Access denied to container registry";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Insufficient Permissions");
                assert.strictEqual(result.retryable, false);
            });

            it("classifies 'not authorized' error as Insufficient Permissions (!retryable)", () => {
                const error = "Not authorized to perform this action";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Insufficient Permissions");
                assert.strictEqual(result.retryable, false);
            });

            it("is case-insensitive for permission keywords", () => {
                const error = "PERMISSION DENIED";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Insufficient Permissions");
                assert.strictEqual(result.retryable, false);
            });
        });

        describe("Network errors", () => {
            it("classifies 'timeout' error as Network Error (retryable)", () => {
                const error = new Error("Request timeout");

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
                assert.strictEqual(result.retryable, true);
            });

            it("classifies 'network' error as Network Error (retryable)", () => {
                const error = "Network connection lost";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
                assert.strictEqual(result.retryable, true);
            });

            it("classifies 'econnrefused' error as Network Error (retryable)", () => {
                const error = "ECONNREFUSED: connection refused";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
                assert.strictEqual(result.retryable, true);
            });

            it("classifies 'enotfound' error as Network Error (retryable)", () => {
                const error = "ENOTFOUND: getaddrinfo ENOTFOUND example.com";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
                assert.strictEqual(result.retryable, true);
            });

            it("classifies 'connection' error as Network Error (retryable)", () => {
                const error = "Connection reset by peer";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
                assert.strictEqual(result.retryable, true);
            });

            it("classifies 'unreachable' error as Network Error (retryable)", () => {
                const error = "Host unreachable";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
                assert.strictEqual(result.retryable, true);
            });

            it("is case-insensitive for network keywords", () => {
                const error = "TIMEOUT occurred";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
                assert.strictEqual(result.retryable, true);
            });
        });

        describe("Validation errors", () => {
            it("classifies 'invalid' error as Validation Error (!retryable)", () => {
                const error = new Error("Invalid cluster name");

                const result = classifyError(error);

                assert.strictEqual(result.title, "Validation Error");
                assert.strictEqual(result.retryable, false);
                assert.ok(result.detail.includes("Invalid cluster name"));
            });

            it("classifies 'required' error as Validation Error (!retryable)", () => {
                const error = "Field 'resourceGroup' is required";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Validation Error");
                assert.strictEqual(result.retryable, false);
            });

            it("classifies 'missing' error as Validation Error (!retryable)", () => {
                const error = "Missing configuration value";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Validation Error");
                assert.strictEqual(result.retryable, false);
            });

            it("classifies 'validation' error as Validation Error (!retryable)", () => {
                const error = "Validation failed: invalid input";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Validation Error");
                assert.strictEqual(result.retryable, false);
            });

            it("is case-insensitive for validation keywords", () => {
                const error = "INVALID format";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Validation Error");
                assert.strictEqual(result.retryable, false);
            });
        });

        describe("Unknown/default errors", () => {
            it("classifies unknown error string as 'An Error Occurred' (retryable)", () => {
                const error = "Something went wrong";

                const result = classifyError(error);

                assert.strictEqual(result.title, "An Error Occurred");
                assert.strictEqual(result.retryable, true);
                assert.strictEqual(result.detail, "Something went wrong");
            });

            it("classifies Error object with generic message as 'An Error Occurred' (retryable)", () => {
                const error = new Error("Failed to execute");

                const result = classifyError(error);

                assert.strictEqual(result.title, "An Error Occurred");
                assert.strictEqual(result.retryable, true);
                assert.strictEqual(result.detail, "Failed to execute");
            });

            it("classifies null/undefined as 'An Error Occurred' (retryable)", () => {
                const result = classifyError(null);

                assert.strictEqual(result.title, "An Error Occurred");
                assert.strictEqual(result.retryable, true);
            });

            it("handles empty string as 'An Error Occurred' (retryable)", () => {
                const result = classifyError("");

                assert.strictEqual(result.title, "An Error Occurred");
                assert.strictEqual(result.retryable, true);
            });

            it("uses fallback message for unknown error", () => {
                const result = classifyError(undefined);

                assert.strictEqual(result.title, "An Error Occurred");
                assert.ok(result.detail.length > 0);
            });
        });

        describe("Error object handling", () => {
            it("extracts message from Error object", () => {
                const error = new Error("Extracted error message");

                const result = classifyError(error);

                assert.strictEqual(result.detail, "Extracted error message");
            });

            it("handles object with 'message' property", () => {
                const error = { message: "Custom error object" };

                const result = classifyError(error);

                assert.ok(result.detail.includes("Custom error object"));
            });

            it("converts non-string message property to string", () => {
                const error = { message: 12345 };

                const result = classifyError(error);

                assert.ok(result.detail.includes("12345"));
            });

            it("handles objects without message property", () => {
                const error = { code: "ERR_CODE" };

                const result = classifyError(error);

                assert.strictEqual(result.title, "An Error Occurred");
            });
        });

        describe("Error priority/precedence", () => {
            it("prioritizes authentication over network errors", () => {
                const error = "unauthorized network timeout";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Authentication Required");
            });

            it("prioritizes permission over validation errors", () => {
                const error = "forbidden invalid input";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Insufficient Permissions");
            });

            it("prioritizes network over validation errors", () => {
                const error = "timeout invalid value";

                const result = classifyError(error);

                assert.strictEqual(result.title, "Network Error");
            });
        });

        describe("Result structure", () => {
            it("always includes title, detail, and retryable fields", () => {
                const error = "test error";

                const result = classifyError(error);

                assert.ok(result.title !== undefined);
                assert.ok(result.detail !== undefined);
                assert.strictEqual(typeof result.retryable, "boolean");
            });

            it("includes fixCommand for authentication errors only", () => {
                const authError = "unauthorized";
                const permError = "forbidden";

                const authResult = classifyError(authError);
                const permResult = classifyError(permError);

                assert.ok(authResult.fixCommand !== undefined);
                assert.strictEqual(authResult.fixCommand.id, "az.login");
                assert.strictEqual(authResult.fixCommand.label, "Run az login");
                assert.strictEqual(permResult.fixCommand, undefined);
            });

            it("omits fixCommand for non-authentication errors", () => {
                const errors = ["forbidden", "timeout", "invalid", "unknown error"];

                errors.forEach((error) => {
                    const result = classifyError(error);
                    assert.strictEqual(result.fixCommand, undefined);
                });
            });
        });
    });
});
