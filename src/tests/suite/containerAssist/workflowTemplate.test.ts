import * as assert from "assert";
import * as yaml from "js-yaml";
import {
    renderWorkflowTemplate,
    validateWorkflowConfig,
    WorkflowConfig,
    MultiContainerWorkflowConfig,
    renderMultiContainerWorkflowTemplate,
    validateMultiContainerWorkflowConfig,
} from "../../../commands/aksContainerAssist/workflowTemplate";

describe("Workflow Template Tests", () => {
    const validConfig: WorkflowConfig = {
        workflowName: "Deploy to AKS",
        branchName: "main",
        containerName: "my-app",
        dockerFile: "Dockerfile",
        buildContextPath: ".",
        acrResourceGroup: "my-rg",
        azureContainerRegistry: "myacr",
        clusterName: "my-cluster",
        clusterResourceGroup: "my-cluster-rg",
        deploymentManifestPath: "k8s/*.yaml",
        namespace: "default",
        isManagedNamespace: false,
    };

    describe("renderWorkflowTemplate", () => {
        it("should render template with all variables replaced", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("name: Deploy to AKS"), "Workflow name should be in output");
            assert.ok(result.includes("branches: [main]"), "Branch name should be in output");
            assert.ok(result.includes("CONTAINER_NAME: my-app"), "Container name should be in output");
            assert.ok(result.includes("DOCKER_FILE: Dockerfile"), "Dockerfile path should be in output");
            assert.ok(result.includes("BUILD_CONTEXT_PATH: ."), "Build context should be in output");
            assert.ok(result.includes("ACR_RESOURCE_GROUP: my-rg"), "ACR resource group should be in output");
            assert.ok(result.includes("AZURE_CONTAINER_REGISTRY: myacr"), "ACR name should be in output");
            assert.ok(result.includes("CLUSTER_NAME: my-cluster"), "Cluster name should be in output");
            assert.ok(result.includes("CLUSTER_RESOURCE_GROUP: my-cluster-rg"), "Cluster RG should be in output");
            assert.ok(result.includes("DEPLOYMENT_MANIFEST_PATH: k8s/*.yaml"), "Manifest path should be in output");
            assert.ok(result.includes("NAMESPACE: default"), "Namespace should be in output");
        });

        it("should not contain any unreplaced template variables", () => {
            const result = renderWorkflowTemplate(validConfig);

            // Check for our template variables ({ { WORD } } without $ prefix)
            // GitHub Actions variables like ${{ }} should be preserved
            const lines = result.split("\n");
            const ourTemplateVars = lines.filter((line) => {
                // Match { { WORD } } but not ${{...}}
                const match = line.match(/(?<!\$)\{\s*\{\s*[A-Z]+\s*\}\s*\}/);
                return match !== null;
            });

            assert.strictEqual(ourTemplateVars.length, 0, "Should not contain unreplaced template variables");
        });

        it("should preserve GitHub Actions variable syntax", () => {
            const result = renderWorkflowTemplate(validConfig);

            // Check that GitHub Actions variables are preserved (these use ${{ }} syntax)
            assert.ok(result.includes("${{ secrets.AZURE_CLIENT_ID }}"), "Should preserve GitHub secrets syntax");
            assert.ok(result.includes("${{ env.AZURE_CONTAINER_REGISTRY }}"), "Should preserve GitHub env syntax");
            assert.ok(result.includes("${{ github.sha }}"), "Should preserve GitHub context syntax");
        });

        it("should generate valid YAML structure", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("name:"), "Should have name field");
            assert.ok(result.includes("on:"), "Should have on field");
            assert.ok(result.includes("env:"), "Should have env field");
            assert.ok(result.includes("jobs:"), "Should have jobs field");
            assert.ok(result.includes("buildImage:"), "Should have buildImage job");
            assert.ok(result.includes("deploy:"), "Should have deploy job");
        });
    });

    describe("validateWorkflowConfig", () => {
        it("should return no errors for valid configuration", () => {
            const errors = validateWorkflowConfig(validConfig);
            assert.strictEqual(errors.length, 0, "Valid config should have no errors");
        });

        it("should return error when workflow name is empty", () => {
            const config = { ...validConfig, workflowName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Workflow name")),
                "Should have workflow name error",
            );
        });

        it("should return error when branch name is empty", () => {
            const config = { ...validConfig, branchName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Branch name")),
                "Should have branch name error",
            );
        });

        it("should return error when container name is empty", () => {
            const config = { ...validConfig, containerName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Container name")),
                "Should have container name error",
            );
        });

        it("should return error when dockerfile path is empty", () => {
            const config = { ...validConfig, dockerFile: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Dockerfile path")),
                "Should have dockerfile path error",
            );
        });

        it("should return error when ACR name is empty", () => {
            const config = { ...validConfig, azureContainerRegistry: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Azure Container Registry")),
                "Should have ACR name error",
            );
        });

        it("should return error when cluster name is empty", () => {
            const config = { ...validConfig, clusterName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Cluster name")),
                "Should have cluster name error",
            );
        });

        it("should return error when namespace is empty", () => {
            const config = { ...validConfig, namespace: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Namespace")),
                "Should have namespace error",
            );
        });

        it("should return multiple errors for multiple invalid fields", () => {
            const config = {
                ...validConfig,
                workflowName: "",
                branchName: "",
                containerName: "",
            };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length >= 3, "Should have multiple validation errors");
        });
    });

    describe("Template Content", () => {
        it("should include buildImage job with correct steps", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("buildImage:"), "Should have buildImage job");
            assert.ok(result.includes("actions/checkout@v4"), "Should checkout code");
            assert.ok(result.includes("azure/login@v2"), "Should login to Azure");
            assert.ok(result.includes("az acr login"), "Should login to ACR");
            assert.ok(result.includes("az acr build"), "Should build and push image");
        });

        it("should include deploy job with correct dependencies", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("deploy:"), "Should have deploy job");
            assert.ok(result.includes("needs: [buildImage]"), "Should depend on buildImage");
        });

        it("should include kubelogin setup", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("azure/use-kubelogin@v1"), "Should use kubelogin action");
            assert.ok(result.includes("kubelogin-version"), "Should specify kubelogin version");
        });

        it("should include AKS context setup", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("azure/aks-set-context@v4"), "Should set AKS context");
            assert.ok(result.includes('use-kubelogin: "true"'), "Should enable kubelogin");
        });

        it("should include deployment step", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("Azure/k8s-deploy@v5"), "Should use k8s-deploy action");
            assert.ok(result.includes("action: deploy"), "Should specify deploy action");
        });

        it("should not annotate namespace with workload identity metadata for non-managed namespaces", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(!result.includes("Annotate namespace"), "Should not have annotate namespace step");
            assert.ok(!result.includes("kubectl annotate namespace"), "Should not annotate the namespace");
            assert.ok(
                !result.includes("aks-project/workload-identity-id="),
                "Should not set workload-identity-id on namespace",
            );
            assert.ok(
                !result.includes("aks-project/workload-identity-tenant="),
                "Should not set workload-identity-tenant on namespace",
            );
        });

        it("should annotate deployments with aks-project traceability metadata", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("Annotate deployment"), "Should have annotate deployment step");
            assert.ok(result.includes("kubectl annotate deployment --all"), "Should annotate all deployments");
            assert.ok(result.includes("aks-project/pipeline-repo="), "Should set pipeline-repo annotation");
            assert.ok(result.includes("aks-project/pipeline-workflow="), "Should set pipeline-workflow annotation");
            assert.ok(
                result.includes('aks-project/deployed-by="vscode"'),
                "Should set deployed-by annotation to vscode",
            );
            assert.ok(result.includes("aks-project/pipeline-run-url="), "Should set pipeline-run-url annotation");
            assert.ok(result.includes("github.run_id"), "Should include run ID in pipeline-run-url");
        });

        it("should not use legacy aks-tools annotation prefix", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(!result.includes("aks-tools/repo"), "Should not use legacy aks-tools/repo");
            assert.ok(!result.includes("aks-tools/pipeline"), "Should not use legacy aks-tools/pipeline");
            assert.ok(
                !result.includes("aks-tools/managed-identity-client-id"),
                "Should not use legacy aks-tools/managed-identity-client-id",
            );
            assert.ok(!result.includes("aks-tools/tenant-id"), "Should not use legacy aks-tools/tenant-id");
        });

        it("should not place identity annotations on deployment", () => {
            const result = renderWorkflowTemplate(validConfig);

            // Identity annotations are removed for non-managed template and must not appear in deployment annotation
            const deployAnnotateIdx = result.indexOf("kubectl annotate deployment --all");
            assert.ok(deployAnnotateIdx !== -1, "Deployment annotation step should exist");

            // Workload identity keys must not appear after the deployment annotate command
            const afterDeployAnnotate = result.slice(deployAnnotateIdx);
            assert.ok(
                !afterDeployAnnotate.includes("workload-identity-id"),
                "workload-identity-id should not be in the deployment annotation block",
            );
            assert.ok(
                !afterDeployAnnotate.includes("workload-identity-tenant"),
                "workload-identity-tenant should not be in the deployment annotation block",
            );
        });

        it("should not include private cluster checks", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(!result.includes("Is private cluster"), "Should not check if cluster is private");
            assert.ok(!result.includes("PRIVATE_CLUSTER"), "Should not have PRIVATE_CLUSTER output");
        });

        it("should use aks-set-context for non-managed namespaces", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("azure/aks-set-context@v4"), "Should use aks-set-context");
            assert.ok(!result.includes("az aks namespace get-credentials"), "Should not use namespace get-credentials");
        });

        it("should use az aks namespace get-credentials for managed namespaces", () => {
            const managedConfig = { ...validConfig, isManagedNamespace: true };
            const result = renderWorkflowTemplate(managedConfig);

            assert.ok(
                !result.includes("azure/aks-set-context@v4"),
                "Should not use aks-set-context for managed namespace",
            );
            assert.ok(result.includes("az aks namespace get-credentials"), "Should use namespace get-credentials");
            assert.ok(result.includes("kubelogin convert-kubeconfig"), "Should convert kubeconfig with kubelogin");
            assert.ok(result.includes("managed namespace"), "Should indicate managed namespace in comments");
        });

        it("should annotate namespace and deployment in managed namespace template", () => {
            const managedConfig = { ...validConfig, isManagedNamespace: true };
            const result = renderWorkflowTemplate(managedConfig);

            assert.ok(result.includes("Annotate namespace"), "Managed template should have annotate namespace step");
            assert.ok(
                result.includes("az aks namespace update"),
                "Managed template should update namespace annotations via az aks namespace update",
            );
            assert.ok(
                result.includes("--annotations"),
                "Managed template should pass annotations to az aks namespace update",
            );
            assert.ok(
                result.includes("aks-project/workload-identity-id="),
                "Managed template should set workload-identity-id on namespace",
            );
            assert.ok(
                result.includes("aks-project/workload-identity-tenant="),
                "Managed template should set workload-identity-tenant on namespace",
            );
            assert.ok(result.includes("Annotate deployment"), "Managed template should have annotate deployment step");
            assert.ok(
                result.includes("kubectl annotate deployment --all"),
                "Managed template should annotate all deployments",
            );
        });

        it("should export KUBECONFIG to GITHUB_ENV in managed namespace template so all steps share it", () => {
            const managedConfig = { ...validConfig, isManagedNamespace: true };
            const result = renderWorkflowTemplate(managedConfig);

            // KUBECONFIG must be persisted to $GITHUB_ENV so k8s-deploy and annotation steps all pick it up
            assert.ok(
                result.includes('echo "KUBECONFIG=') && result.includes(">> $GITHUB_ENV"),
                "Should export KUBECONFIG to GITHUB_ENV in the Get K8s context step",
            );
        });
    });
});

describe("Multi-Container Workflow Template Tests", () => {
    const validMultiConfig: MultiContainerWorkflowConfig = {
        workflowName: "deploy-monorepo",
        branchName: "main",
        acrResourceGroup: "shared-rg",
        azureContainerRegistry: "monoacr",
        clusterName: "mono-cluster",
        clusterResourceGroup: "mono-cluster-rg",
        namespace: "apps",
        isManagedNamespace: false,
        containers: [
            {
                containerName: "frontend",
                dockerFile: "Dockerfile",
                buildContextPath: "frontend",
                deploymentManifestPath: "frontend/k8s/deployment.yaml",
            },
            {
                containerName: "api",
                dockerFile: "Dockerfile",
                buildContextPath: "api",
                deploymentManifestPath: "|\n        api/k8s/deployment.yaml\n        api/k8s/service.yaml",
            },
        ],
    };

    describe("renderMultiContainerWorkflowTemplate", () => {
        it("renders one build+deploy job pair per container", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);

            assert.ok(yaml.includes("build-frontend:"), "Should have build-frontend job");
            assert.ok(yaml.includes("deploy-frontend:"), "Should have deploy-frontend job");
            assert.ok(yaml.includes("build-api:"), "Should have build-api job");
            assert.ok(yaml.includes("deploy-api:"), "Should have deploy-api job");
            assert.ok(yaml.includes("needs: [build-frontend]"), "deploy-frontend should depend on build-frontend");
            assert.ok(yaml.includes("needs: [build-api]"), "deploy-api should depend on build-api");
        });

        it("places per-container values in per-job env, shared values at workflow level", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);

            assert.ok(yaml.includes("AZURE_CONTAINER_REGISTRY: monoacr"), "ACR should be at workflow env");
            assert.ok(yaml.includes("NAMESPACE: apps"), "namespace should be at workflow env");
            assert.ok(yaml.includes("CONTAINER_NAME: frontend"), "frontend job should set CONTAINER_NAME");
            assert.ok(yaml.includes("CONTAINER_NAME: api"), "api job should set CONTAINER_NAME");
            assert.ok(yaml.includes("BUILD_CONTEXT_PATH: frontend"), "frontend build context should appear");
            assert.ok(yaml.includes("BUILD_CONTEXT_PATH: api"), "api build context should appear");
        });

        it("does not contain unreplaced template placeholders", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);
            const unreplaced = yaml.match(/(?<!\$)\{\s*\{\s*[A-Z_]+\s*\}\s*\}/g);
            assert.strictEqual(unreplaced, null, "Should not contain any unreplaced { { X } } placeholders");
        });

        it("preserves GitHub Actions ${{ ... }} expressions", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);
            assert.ok(yaml.includes("${{ secrets.AZURE_CLIENT_ID }}"));
            assert.ok(yaml.includes("${{ env.AZURE_CONTAINER_REGISTRY }}"));
            assert.ok(yaml.includes("${{ github.sha }}"));
        });

        it("uses az aks namespace get-credentials when isManagedNamespace is true", () => {
            const managed = { ...validMultiConfig, isManagedNamespace: true };
            const yaml = renderMultiContainerWorkflowTemplate(managed);
            assert.ok(yaml.includes("az aks namespace get-credentials"), "Should use managed-ns credential flow");
            assert.ok(!yaml.includes("azure/aks-set-context@v4"), "Should not use aks-set-context for managed ns");
        });

        it("uses azure/aks-set-context@v4 for non-managed namespaces", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);
            assert.ok(yaml.includes("azure/aks-set-context@v4"));
            assert.ok(!yaml.includes("az aks namespace get-credentials"));
        });

        it("omits the deploy job for containers without a manifest path (Skip)", () => {
            const cfg: MultiContainerWorkflowConfig = {
                ...validMultiConfig,
                containers: [
                    { containerName: "worker", dockerFile: "Dockerfile", buildContextPath: "worker" }, // no manifest
                    {
                        containerName: "api",
                        dockerFile: "Dockerfile",
                        buildContextPath: "api",
                        deploymentManifestPath: "api/k8s/deployment.yaml",
                    },
                ],
            };
            const yaml = renderMultiContainerWorkflowTemplate(cfg);
            assert.ok(yaml.includes("build-worker:"), "worker should still have a build job");
            assert.ok(!yaml.includes("deploy-worker:"), "worker should NOT have a deploy job (skipped)");
            assert.ok(yaml.includes("build-api:"));
            assert.ok(yaml.includes("deploy-api:"));
        });

        it("sanitizes container names into valid GitHub Actions job ids", () => {
            const cfg: MultiContainerWorkflowConfig = {
                ...validMultiConfig,
                containers: [
                    {
                        containerName: "My Service@v1",
                        dockerFile: "Dockerfile",
                        buildContextPath: "svc",
                        deploymentManifestPath: "svc/k8s/dep.yaml",
                    },
                ],
            };
            const yaml = renderMultiContainerWorkflowTemplate(cfg);
            // Job id must only contain [A-Za-z0-9_-] and start with letter/underscore
            const buildJobMatch = yaml.match(/^ {4}(build-[A-Za-z_][A-Za-z0-9_-]*):$/m);
            assert.ok(buildJobMatch, `Build job id should be sanitized; got:\n${yaml}`);
        });

        it("emits a lowercase OCI-safe image repo (CONTAINER_NAME) in build/deploy env", () => {
            const cfg: MultiContainerWorkflowConfig = {
                ...validMultiConfig,
                containers: [
                    {
                        containerName: "My Service@v1",
                        dockerFile: "Dockerfile",
                        buildContextPath: "svc",
                        deploymentManifestPath: "svc/k8s/dep.yaml",
                    },
                ],
            };
            const rendered = renderMultiContainerWorkflowTemplate(cfg);
            // No uppercase characters or '@' allowed in the env value emitted
            // as CONTAINER_NAME (the value is used as the ACR image repo).
            const containerNameLines = rendered.split("\n").filter((line) => line.includes("CONTAINER_NAME:"));
            assert.ok(containerNameLines.length >= 1, "Should emit at least one CONTAINER_NAME line");
            for (const line of containerNameLines) {
                const value = line.split("CONTAINER_NAME:")[1].trim();
                assert.ok(
                    /^[a-z0-9._-]+$/.test(value),
                    `CONTAINER_NAME must be OCI-safe (lowercase [a-z0-9._-]); got "${value}"`,
                );
            }
        });

        it("double-quotes DOCKER_FILE and BUILD_CONTEXT_PATH in the az acr build command", () => {
            const rendered = renderMultiContainerWorkflowTemplate(validMultiConfig);
            // Paths can contain spaces; without quotes the shell would split them.
            assert.ok(
                rendered.includes('-f "${{ env.DOCKER_FILE }}" "${{ env.BUILD_CONTEXT_PATH }}"'),
                "az acr build should quote DOCKER_FILE and BUILD_CONTEXT_PATH",
            );
        });

        it("renders an Annotate namespace step in the multi-container managed-namespace deploy job", () => {
            const managed: MultiContainerWorkflowConfig = { ...validMultiConfig, isManagedNamespace: true };
            const rendered = renderMultiContainerWorkflowTemplate(managed);
            assert.ok(
                rendered.includes("Annotate namespace"),
                "Managed-namespace multi-container deploy job should annotate the namespace",
            );
            assert.ok(rendered.includes("az aks namespace update"));
            assert.ok(rendered.includes("aks-project/workload-identity-id="));
            assert.ok(rendered.includes("aks-project/workload-identity-tenant="));
        });

        it("produces structurally valid YAML even with multi-manifest block scalars", () => {
            // Reproduces the exact shape formatManifestPathForYamlBlock produces
            // for multiple manifests \u2014 a `|` block scalar with content indented
            // for the single-container (workflow-level) env. The multi-container
            // renderer must re-indent this so it stays valid under a per-job env.
            const cfg: MultiContainerWorkflowConfig = {
                ...validMultiConfig,
                containers: [
                    {
                        containerName: "api",
                        dockerFile: "Dockerfile",
                        buildContextPath: "api",
                        deploymentManifestPath:
                            "|\n        api/k8s/deployment.yaml\n        api/k8s/service.yaml\n        api/k8s/ingress.yaml",
                    },
                ],
            };
            const rendered = renderMultiContainerWorkflowTemplate(cfg);

            let parsed: unknown;
            assert.doesNotThrow(() => {
                parsed = yaml.load(rendered);
            }, `Rendered workflow must be valid YAML. Rendered:\n${rendered}`);

            // Inspect the parsed structure to confirm the manifest list survived
            // re-indentation and is attached to the expected env key.
            const root = parsed as {
                jobs?: Record<string, { env?: Record<string, string>; needs?: string[] }>;
            };
            assert.ok(root.jobs, "Parsed YAML should have a top-level jobs map");
            const deployApi = root.jobs!["deploy-api"];
            assert.ok(deployApi, "Should contain a deploy-api job");
            const manifestEnv = deployApi.env?.DEPLOYMENT_MANIFEST_PATH;
            assert.ok(
                typeof manifestEnv === "string" && manifestEnv.includes("api/k8s/deployment.yaml"),
                `deploy-api env.DEPLOYMENT_MANIFEST_PATH should contain the manifests; got ${JSON.stringify(manifestEnv)}`,
            );
            assert.ok(manifestEnv!.includes("api/k8s/service.yaml"));
            assert.ok(manifestEnv!.includes("api/k8s/ingress.yaml"));
        });

        it("produces structurally valid YAML for the standard multi-container config", () => {
            const rendered = renderMultiContainerWorkflowTemplate(validMultiConfig);
            assert.doesNotThrow(() => yaml.load(rendered), `Rendered workflow must be valid YAML:\n${rendered}`);
        });
    });

    describe("validateMultiContainerWorkflowConfig", () => {
        it("returns no errors for a valid configuration", () => {
            assert.deepStrictEqual(validateMultiContainerWorkflowConfig(validMultiConfig), []);
        });

        it("returns an error when no containers are provided", () => {
            const cfg = { ...validMultiConfig, containers: [] };
            const errs = validateMultiContainerWorkflowConfig(cfg);
            assert.ok(errs.some((e) => e.includes("At least one container")));
        });

        it("returns errors for missing per-container fields", () => {
            const cfg: MultiContainerWorkflowConfig = {
                ...validMultiConfig,
                containers: [{ containerName: "", dockerFile: "", buildContextPath: "" }],
            };
            const errs = validateMultiContainerWorkflowConfig(cfg);
            assert.ok(errs.some((e) => e.toLowerCase().includes("container name")));
            assert.ok(errs.some((e) => e.toLowerCase().includes("dockerfile")));
            assert.ok(errs.some((e) => e.toLowerCase().includes("build context")));
        });

        it("detects duplicate job ids derived from container names", () => {
            const cfg: MultiContainerWorkflowConfig = {
                ...validMultiConfig,
                containers: [
                    {
                        containerName: "api",
                        dockerFile: "Dockerfile",
                        buildContextPath: "api",
                        deploymentManifestPath: "api/k8s/dep.yaml",
                    },
                    {
                        containerName: "api",
                        dockerFile: "Dockerfile",
                        buildContextPath: "api2",
                        deploymentManifestPath: "api2/k8s/dep.yaml",
                    },
                ],
            };
            const errs = validateMultiContainerWorkflowConfig(cfg);
            assert.ok(errs.some((e) => e.toLowerCase().includes("duplicate")));
        });

        it("returns errors for missing workflow-level fields", () => {
            const cfg = { ...validMultiConfig, workflowName: "", clusterName: "", azureContainerRegistry: "" };
            const errs = validateMultiContainerWorkflowConfig(cfg);
            assert.ok(errs.some((e) => e.includes("Workflow name")));
            assert.ok(errs.some((e) => e.includes("Cluster name")));
            assert.ok(errs.some((e) => e.includes("Azure Container Registry")));
        });
    });
});
