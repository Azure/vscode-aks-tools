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
            assert.ok(/actions\/checkout@[0-9a-f]{40}\b/.test(result), "Should checkout code (SHA-pinned)");
            assert.ok(/azure\/login@[0-9a-f]{40}\b/.test(result), "Should login to Azure (SHA-pinned)");
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

            assert.ok(/azure\/use-kubelogin@[0-9a-f]{40}\b/.test(result), "Should use kubelogin action (SHA-pinned)");
            assert.ok(result.includes("kubelogin-version"), "Should specify kubelogin version");
        });

        it("substitutes the kubelogin version placeholder with a well-formed release tag", () => {
            // The template contains `kubelogin-version: "{ { KUBELOGINVERSION } }"` which
            // must be replaced with the current `azure.kubelogin.releaseTag` setting value
            // (or the package.json default fallback). Regression guard for a duplicate
            // hard-coded version drifting from the settings default.
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(!result.includes("KUBELOGINVERSION"), "Kubelogin placeholder should have been substituted");
            const match = result.match(/kubelogin-version:\s*"(v\d+\.\d+\.\d+)"/);
            assert.ok(match, "Rendered kubelogin-version should be a well-formed semver tag (vX.Y.Z)");
        });

        it("should include AKS context setup", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(/azure\/aks-set-context@[0-9a-f]{40}\b/.test(result), "Should set AKS context (SHA-pinned)");
            assert.ok(result.includes('use-kubelogin: "true"'), "Should enable kubelogin");
        });

        it("should include deployment step", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(/Azure\/k8s-deploy@[0-9a-f]{40}\b/.test(result), "Should use k8s-deploy action (SHA-pinned)");
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

            assert.ok(/azure\/aks-set-context@[0-9a-f]{40}\b/.test(result), "Should use aks-set-context (SHA-pinned)");
            assert.ok(!result.includes("az aks namespace get-credentials"), "Should not use namespace get-credentials");
        });

        it("should use az aks namespace get-credentials for managed namespaces", () => {
            const managedConfig = { ...validConfig, isManagedNamespace: true };
            const result = renderWorkflowTemplate(managedConfig);

            assert.ok(
                !result.includes("azure/aks-set-context@"),
                "Should not use aks-set-context for managed namespace",
            );
            assert.ok(result.includes("az aks namespace get-credentials"), "Should use namespace get-credentials");
            assert.ok(result.includes("kubelogin convert-kubeconfig"), "Should convert kubeconfig with kubelogin");
            assert.ok(result.includes("managed namespace"), "Should indicate managed namespace in comments");
        });

        it("should not annotate the managed namespace from CI — workload-identity annotations are written once by OIDC setup", () => {
            const managedConfig = { ...validConfig, isManagedNamespace: true };
            const result = renderWorkflowTemplate(managedConfig);

            assert.ok(
                !result.includes("Annotate namespace"),
                "Managed template should not have an annotate-namespace CI step",
            );
            assert.ok(
                !result.includes("az aks namespace update"),
                "Managed template should not call az aks namespace update from CI",
            );
            assert.ok(
                !result.includes("aks-project/workload-identity-id"),
                "Managed template should not stamp workload-identity-id from CI",
            );
            assert.ok(
                !result.includes("aks-project/workload-identity-tenant"),
                "Managed template should not stamp workload-identity-tenant from CI",
            );

            assert.ok(result.includes("Annotate deployment"), "Managed template should still annotate deployments");
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
        it("renders a matrix build job and per-container deploy jobs", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);

            assert.ok(yaml.includes("build:"), "Should have a single build job");
            assert.ok(yaml.includes("strategy:"), "Build job should use strategy");
            assert.ok(yaml.includes("matrix:"), "Build job should use matrix");
            assert.ok(yaml.includes("service: frontend"), "Matrix should include frontend service");
            assert.ok(yaml.includes("service: api"), "Matrix should include api service");
            assert.ok(yaml.includes("deploy-frontend:"), "Should have deploy-frontend job");
            assert.ok(yaml.includes("deploy-api:"), "Should have deploy-api job");
            assert.ok(yaml.includes("needs: [build]"), "deploy jobs should depend on build");
        });

        it("places per-container values in matrix entries, shared values at workflow level", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);

            assert.ok(yaml.includes("AZURE_CONTAINER_REGISTRY: monoacr"), "ACR should be at workflow env");
            assert.ok(yaml.includes("NAMESPACE: apps"), "namespace should be at workflow env");
            assert.ok(yaml.includes("image: frontend"), "matrix should include frontend image");
            assert.ok(yaml.includes("image: api"), "matrix should include api image");
            assert.ok(yaml.includes("build_context: frontend"), "matrix should include frontend build context");
            assert.ok(yaml.includes("build_context: api"), "matrix should include api build context");
            assert.ok(yaml.includes(".azurecr.io/frontend:"), "deploy-frontend job should reference frontend image");
            assert.ok(yaml.includes(".azurecr.io/api:"), "deploy-api job should reference api image");
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

        it("substitutes the kubelogin version placeholder in every deploy job", () => {
            // Every deploy job renders its own copy of the kubelogin setup, so a
            // regression in the multi-container renderer could leave one job's
            // placeholder unsubstituted while others are fine.
            const cfg: MultiContainerWorkflowConfig = {
                ...validMultiConfig,
                containers: [
                    {
                        containerName: "api",
                        dockerFile: "api/Dockerfile",
                        buildContextPath: "api",
                        deploymentManifestPath: "api/k8s",
                    },
                    {
                        containerName: "web",
                        dockerFile: "web/Dockerfile",
                        buildContextPath: "web",
                        deploymentManifestPath: "web/k8s",
                    },
                ],
            };
            const yaml = renderMultiContainerWorkflowTemplate(cfg);

            assert.ok(!yaml.includes("KUBELOGINVERSION"), "No deploy job should contain an unsubstituted placeholder");
            const matches = yaml.match(/kubelogin-version:\s*"v\d+\.\d+\.\d+"/g);
            assert.ok(
                matches && matches.length >= 2,
                `Expected kubelogin-version in each deploy job; got ${matches?.length ?? 0}`,
            );
            // All rendered versions should agree — one config value, consistent across jobs.
            const unique = new Set(matches);
            assert.strictEqual(
                unique.size,
                1,
                `All deploy jobs should use the same kubelogin version; got ${[...unique].join(", ")}`,
            );
        });

        it("uses az aks namespace get-credentials when isManagedNamespace is true", () => {
            const managed = { ...validMultiConfig, isManagedNamespace: true };
            const yaml = renderMultiContainerWorkflowTemplate(managed);
            assert.ok(yaml.includes("az aks namespace get-credentials"), "Should use managed-ns credential flow");
            assert.ok(!yaml.includes("azure/aks-set-context@"), "Should not use aks-set-context for managed ns");
        });

        it("uses a SHA-pinned azure/aks-set-context for non-managed namespaces", () => {
            const yaml = renderMultiContainerWorkflowTemplate(validMultiConfig);
            assert.ok(/azure\/aks-set-context@[0-9a-f]{40}\b/.test(yaml));
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
            assert.ok(yaml.includes("service: worker"), "worker should still be in matrix build");
            assert.ok(!yaml.includes("deploy-worker:"), "worker should NOT have a deploy job (skipped)");
            assert.ok(yaml.includes("service: api"), "api should be in matrix build");
            assert.ok(yaml.includes("deploy-api:"), "api should have a deploy job");
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
            // Deploy job id must only contain [A-Za-z0-9_-] and start with letter/underscore
            const deployJobMatch = yaml.match(/^ {4}(deploy-[A-Za-z_][A-Za-z0-9_-]*):$/m);
            assert.ok(deployJobMatch, `Deploy job id should be sanitized; got:\n${yaml}`);
        });

        it("emits a lowercase OCI-safe image name in matrix entries and deploy env", () => {
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
            // Check matrix image values are OCI-safe
            const imageLines = rendered.split("\n").filter((line) => line.trim().startsWith("image:"));
            assert.ok(imageLines.length >= 1, "Should emit at least one image line in matrix");
            for (const line of imageLines) {
                const value = line.split("image:")[1].trim();
                assert.ok(
                    /^[a-z0-9._-]+$/.test(value),
                    `image must be OCI-safe (lowercase [a-z0-9._-]); got "${value}"`,
                );
            }
            // Check image references in the deploy job's images block are OCI-safe.
            // The build job uses a `${{ matrix.image }}` placeholder; only inspect the
            // bare-name refs emitted into deploy jobs.
            const deployImageRefRe = /\.azurecr\.io\/([a-zA-Z0-9._-]+):\$\{\{ github\.sha \}\}/g;
            const deployImageRefs = Array.from(rendered.matchAll(deployImageRefRe), (m) => m[1]);
            assert.ok(deployImageRefs.length >= 1, "Should emit at least one bare-name image ref in the deploy job");
            for (const value of deployImageRefs) {
                assert.ok(
                    /^[a-z0-9._-]+$/.test(value),
                    `deploy image ref must be OCI-safe (lowercase [a-z0-9._-]); got "${value}"`,
                );
            }
        });

        it("double-quotes docker_file and build_context in the az acr build command", () => {
            const rendered = renderMultiContainerWorkflowTemplate(validMultiConfig);
            // Paths can contain spaces; without quotes the shell would split them.
            assert.ok(
                rendered.includes('-f "${{ matrix.docker_file }}" "${{ matrix.build_context }}"'),
                "az acr build should quote matrix.docker_file and matrix.build_context",
            );
        });

        it("does not annotate the managed namespace from CI in the multi-container deploy job", () => {
            const managed: MultiContainerWorkflowConfig = { ...validMultiConfig, isManagedNamespace: true };
            const rendered = renderMultiContainerWorkflowTemplate(managed);
            assert.ok(!rendered.includes("Annotate namespace"));
            assert.ok(!rendered.includes("az aks namespace update"));
            assert.ok(!rendered.includes("aks-project/workload-identity-id"));
            assert.ok(!rendered.includes("aks-project/workload-identity-tenant"));
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

    describe("3-service snapshot test (Issue #2161)", () => {
        const threeServiceConfig: MultiContainerWorkflowConfig = {
            workflowName: "deploy-platform",
            branchName: "main",
            acrResourceGroup: "platform-rg",
            azureContainerRegistry: "platformacr",
            clusterName: "platform-cluster",
            clusterResourceGroup: "platform-cluster-rg",
            namespace: "platform",
            isManagedNamespace: false,
            containers: [
                {
                    containerName: "web",
                    dockerFile: "Dockerfile",
                    buildContextPath: "web",
                    deploymentManifestPath: "web/k8s/deployment.yaml",
                },
                {
                    containerName: "api",
                    dockerFile: "Dockerfile.prod",
                    buildContextPath: "api",
                    deploymentManifestPath: "|\n        api/k8s/deployment.yaml\n        api/k8s/service.yaml",
                },
                {
                    containerName: "worker",
                    dockerFile: "Dockerfile",
                    buildContextPath: "worker",
                    deploymentManifestPath: "worker/k8s/deployment.yaml",
                },
            ],
        };

        it("produces valid YAML with expected structure for a 3-service config", () => {
            const rendered = renderMultiContainerWorkflowTemplate(threeServiceConfig);

            let parsed: unknown;
            assert.doesNotThrow(() => {
                parsed = yaml.load(rendered);
            }, `Rendered workflow must be valid YAML:\n${rendered}`);

            const root = parsed as {
                name?: string;
                env?: Record<string, string>;
                jobs?: Record<string, unknown>;
            };
            assert.strictEqual(root.name, "deploy-platform");
            assert.strictEqual(root.env?.AZURE_CONTAINER_REGISTRY, "platformacr");
            assert.strictEqual(root.env?.NAMESPACE, "platform");
            assert.ok(root.jobs, "Should have jobs");
            assert.ok(root.jobs!["build"], "Should have a build job");
            assert.ok(root.jobs!["deploy-web"], "Should have deploy-web job");
            assert.ok(root.jobs!["deploy-api"], "Should have deploy-api job");
            assert.ok(root.jobs!["deploy-worker"], "Should have deploy-worker job");
        });

        it("matrix includes all 3 services with correct docker_file and build_context", () => {
            const rendered = renderMultiContainerWorkflowTemplate(threeServiceConfig);
            const parsed = yaml.load(rendered) as {
                jobs?: { build?: { strategy?: { matrix?: { include?: Array<Record<string, string>> } } } };
            };

            const matrix = parsed.jobs?.build?.strategy?.matrix?.include;
            assert.ok(matrix, "Should have matrix include");
            assert.strictEqual(matrix!.length, 3, "Matrix should have 3 entries");
            assert.strictEqual(matrix![0].image, "web");
            assert.strictEqual(matrix![0].docker_file, "Dockerfile");
            assert.strictEqual(matrix![0].build_context, "web");
            assert.strictEqual(matrix![1].image, "api");
            assert.strictEqual(matrix![1].docker_file, "Dockerfile.prod");
            assert.strictEqual(matrix![1].build_context, "api");
            assert.strictEqual(matrix![2].image, "worker");
            assert.strictEqual(matrix![2].docker_file, "Dockerfile");
            assert.strictEqual(matrix![2].build_context, "worker");
        });

        it("all deploy jobs depend on the single build job", () => {
            const rendered = renderMultiContainerWorkflowTemplate(threeServiceConfig);
            const parsed = yaml.load(rendered) as {
                jobs?: Record<string, { needs?: string[] }>;
            };

            assert.deepStrictEqual(parsed.jobs?.["deploy-web"]?.needs, ["build"]);
            assert.deepStrictEqual(parsed.jobs?.["deploy-api"]?.needs, ["build"]);
            assert.deepStrictEqual(parsed.jobs?.["deploy-worker"]?.needs, ["build"]);
        });

        it("multi-manifest block scalar is valid in the parsed structure", () => {
            const rendered = renderMultiContainerWorkflowTemplate(threeServiceConfig);
            const parsed = yaml.load(rendered) as {
                jobs?: Record<string, { env?: Record<string, string> }>;
            };

            const apiManifest = parsed.jobs?.["deploy-api"]?.env?.DEPLOYMENT_MANIFEST_PATH;
            assert.ok(apiManifest, "deploy-api should have DEPLOYMENT_MANIFEST_PATH");
            assert.ok(apiManifest!.includes("api/k8s/deployment.yaml"));
            assert.ok(apiManifest!.includes("api/k8s/service.yaml"));
        });

        it("shared manifest across all services consolidates into a single deploy job (#2163)", () => {
            const sharedManifest = "k8s/shared-deployment.yaml";
            const sharedConfig: MultiContainerWorkflowConfig = {
                ...threeServiceConfig,
                containers: threeServiceConfig.containers.map((c) => ({
                    ...c,
                    deploymentManifestPath: sharedManifest,
                })),
            };
            const rendered = renderMultiContainerWorkflowTemplate(sharedConfig);
            const parsed = yaml.load(rendered) as {
                jobs?: Record<string, { env?: Record<string, string> }>;
            };

            // Per-container deploy jobs must NOT exist when a manifest is shared.
            assert.ok(!parsed.jobs?.["deploy-web"], "deploy-web should not exist when manifest is shared");
            assert.ok(!parsed.jobs?.["deploy-api"], "deploy-api should not exist when manifest is shared");
            assert.ok(!parsed.jobs?.["deploy-worker"], "deploy-worker should not exist when manifest is shared");
            // Exactly one consolidated deploy job that carries the shared manifest path.
            assert.strictEqual(parsed.jobs?.["deploy-shared-1"]?.env?.DEPLOYMENT_MANIFEST_PATH, sharedManifest);
        });
    });
});

describe("Multi-Container Shared-Manifest Deploy Consolidation", () => {
    const base: Omit<MultiContainerWorkflowConfig, "containers"> = {
        workflowName: "deploy-monorepo",
        branchName: "main",
        acrResourceGroup: "shared-rg",
        azureContainerRegistry: "monoacr",
        clusterName: "mono-cluster",
        clusterResourceGroup: "mono-cluster-rg",
        namespace: "apps",
        isManagedNamespace: false,
    };

    it("emits a single deploy job when two containers share the same manifest", () => {
        const cfg: MultiContainerWorkflowConfig = {
            ...base,
            containers: [
                {
                    containerName: "frontend",
                    dockerFile: "Dockerfile",
                    buildContextPath: "frontend",
                    deploymentManifestPath: "k8s/app.yaml",
                },
                {
                    containerName: "api",
                    dockerFile: "Dockerfile",
                    buildContextPath: "api",
                    deploymentManifestPath: "k8s/app.yaml",
                },
            ],
        };
        const rendered = renderMultiContainerWorkflowTemplate(cfg);

        // Matrix build job covers both containers; consolidated single deploy job.
        assert.ok(rendered.includes("service: frontend"), "matrix build should include frontend");
        assert.ok(rendered.includes("service: api"), "matrix build should include api");

        // Exactly one deploy job; per-container deploy jobs must NOT exist for shared manifests.
        assert.ok(!rendered.includes("deploy-frontend:"), "deploy-frontend should not exist (consolidated)");
        assert.ok(!rendered.includes("deploy-api:"), "deploy-api should not exist (consolidated)");
        const deployJobMatches = rendered.match(/^ {4}deploy-[A-Za-z0-9_-]+:$/gm) ?? [];
        assert.strictEqual(deployJobMatches.length, 1, `Expected exactly one deploy job, got ${deployJobMatches}`);
        assert.ok(rendered.includes("deploy-shared-1:"), "consolidated deploy job should be named deploy-shared-1");
    });

    it("the consolidated deploy job depends on the matrix build job", () => {
        const cfg: MultiContainerWorkflowConfig = {
            ...base,
            containers: [
                {
                    containerName: "frontend",
                    dockerFile: "Dockerfile",
                    buildContextPath: "frontend",
                    deploymentManifestPath: "k8s/app.yaml",
                },
                {
                    containerName: "api",
                    dockerFile: "Dockerfile",
                    buildContextPath: "api",
                    deploymentManifestPath: "k8s/app.yaml",
                },
            ],
        };
        const rendered = renderMultiContainerWorkflowTemplate(cfg);
        assert.ok(
            rendered.includes("needs: [build]"),
            `Consolidated deploy job must depend on the matrix build job; got:\n${rendered}`,
        );
    });

    it("the consolidated deploy job lists every container image in the k8s-deploy images block", () => {
        const cfg: MultiContainerWorkflowConfig = {
            ...base,
            containers: [
                {
                    containerName: "frontend",
                    dockerFile: "Dockerfile",
                    buildContextPath: "frontend",
                    deploymentManifestPath: "k8s/app.yaml",
                },
                {
                    containerName: "api",
                    dockerFile: "Dockerfile",
                    buildContextPath: "api",
                    deploymentManifestPath: "k8s/app.yaml",
                },
            ],
        };
        const rendered = renderMultiContainerWorkflowTemplate(cfg);
        const parsed = yaml.load(rendered) as {
            jobs: Record<string, { env?: Record<string, string>; steps: Array<{ with?: { images?: string } }> }>;
        };
        const deploy = parsed.jobs["deploy-shared-1"];
        assert.ok(deploy, "deploy-shared-1 should be present in parsed YAML");
        const deployStep = deploy.steps.find((s) => s.with?.images !== undefined);
        assert.ok(deployStep && deployStep.with?.images, "Deploy step should set k8s-deploy images");
        const images = deployStep.with!.images!;
        assert.ok(
            images.includes(".azurecr.io/frontend:${{ github.sha }}"),
            `images should include frontend ref; got: ${images}`,
        );
        assert.ok(
            images.includes(".azurecr.io/api:${{ github.sha }}"),
            `images should include api ref; got: ${images}`,
        );
        // CONTAINER_NAME env must NOT be present on consolidated deploy jobs.
        assert.ok(
            !deploy.env || deploy.env.CONTAINER_NAME === undefined,
            "Consolidated deploy job should not set CONTAINER_NAME env",
        );
    });

    it("keeps distinct deploy jobs for containers with different manifests", () => {
        const cfg: MultiContainerWorkflowConfig = {
            ...base,
            containers: [
                {
                    containerName: "frontend",
                    dockerFile: "Dockerfile",
                    buildContextPath: "frontend",
                    deploymentManifestPath: "frontend/k8s/dep.yaml",
                },
                {
                    containerName: "api",
                    dockerFile: "Dockerfile",
                    buildContextPath: "api",
                    deploymentManifestPath: "api/k8s/dep.yaml",
                },
            ],
        };
        const rendered = renderMultiContainerWorkflowTemplate(cfg);
        assert.ok(rendered.includes("deploy-frontend:"));
        assert.ok(rendered.includes("deploy-api:"));
        assert.ok(!rendered.includes("deploy-shared-"), "Distinct manifests must not be consolidated");
    });

    it("supports mixed: a shared group + a distinct deploy + a build-only container", () => {
        const cfg: MultiContainerWorkflowConfig = {
            ...base,
            containers: [
                {
                    containerName: "frontend",
                    dockerFile: "Dockerfile",
                    buildContextPath: "frontend",
                    deploymentManifestPath: "k8s/app.yaml",
                },
                {
                    containerName: "api",
                    dockerFile: "Dockerfile",
                    buildContextPath: "api",
                    deploymentManifestPath: "k8s/app.yaml",
                },
                {
                    containerName: "billing",
                    dockerFile: "Dockerfile",
                    buildContextPath: "billing",
                    deploymentManifestPath: "billing/k8s/dep.yaml",
                },
                {
                    containerName: "worker",
                    dockerFile: "Dockerfile",
                    buildContextPath: "worker",
                    // No manifest — build-only.
                },
            ],
        };
        const rendered = renderMultiContainerWorkflowTemplate(cfg);
        const deployJobMatches = rendered.match(/^ {4}deploy-[A-Za-z0-9_-]+:$/gm) ?? [];
        assert.strictEqual(
            deployJobMatches.length,
            2,
            `Expected 2 deploy jobs (shared + billing), got ${deployJobMatches}`,
        );
        assert.ok(rendered.includes("deploy-shared-1:"), "shared deploy job present");
        assert.ok(rendered.includes("deploy-billing:"), "distinct billing deploy job present");
        assert.ok(rendered.includes("service: worker"), "worker is in matrix build");
        assert.ok(!rendered.includes("deploy-worker:"), "worker has no deploy job (skipped)");
    });

    it("produces valid YAML when consolidating with a multi-manifest block scalar", () => {
        const cfg: MultiContainerWorkflowConfig = {
            ...base,
            containers: [
                {
                    containerName: "frontend",
                    dockerFile: "Dockerfile",
                    buildContextPath: "frontend",
                    deploymentManifestPath:
                        "|\n        k8s/deployment.yaml\n        k8s/service.yaml\n        k8s/ingress.yaml",
                },
                {
                    containerName: "api",
                    dockerFile: "Dockerfile",
                    buildContextPath: "api",
                    deploymentManifestPath:
                        "|\n        k8s/deployment.yaml\n        k8s/service.yaml\n        k8s/ingress.yaml",
                },
            ],
        };
        const rendered = renderMultiContainerWorkflowTemplate(cfg);
        let parsed: unknown;
        assert.doesNotThrow(() => {
            parsed = yaml.load(rendered);
        }, `Consolidated workflow must be valid YAML:\n${rendered}`);
        const root = parsed as { jobs: Record<string, { env?: Record<string, string> }> };
        const manifestEnv = root.jobs["deploy-shared-1"]?.env?.DEPLOYMENT_MANIFEST_PATH;
        assert.ok(
            typeof manifestEnv === "string" && manifestEnv.includes("k8s/deployment.yaml"),
            "Consolidated deploy job should carry the shared multi-manifest list",
        );
        assert.ok(manifestEnv!.includes("k8s/service.yaml"));
        assert.ok(manifestEnv!.includes("k8s/ingress.yaml"));
    });
});
