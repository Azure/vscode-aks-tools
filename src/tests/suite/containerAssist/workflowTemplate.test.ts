import * as assert from "assert";
import { renderWorkflowTemplate, validateWorkflowConfig, WorkflowConfig } from "../../../commands/aksContainerAssist/workflowTemplate";

suite("Workflow Template Tests", () => {
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
    };

    suite("renderWorkflowTemplate", () => {
        test("should render template with all variables replaced", () => {
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

        test("should not contain any unreplaced template variables", () => {
            const result = renderWorkflowTemplate(validConfig);

            // Check for our template variables ({{WORD}} without $ prefix)
            // GitHub Actions variables like ${{ }} should be preserved
            const lines = result.split("\n");
            const ourTemplateVars = lines.filter((line) => {
                // Match {{WORD}} but not ${{...}}
                const match = line.match(/(?<!\$){{[A-Z]+}}/);
                return match !== null;
            });

            assert.strictEqual(ourTemplateVars.length, 0, "Should not contain unreplaced template variables");
        });

        test("should preserve GitHub Actions variable syntax", () => {
            const result = renderWorkflowTemplate(validConfig);

            // Check that GitHub Actions variables are preserved (these use ${{ }} syntax)
            assert.ok(result.includes("${{ secrets.AZURE_CLIENT_ID }}"), "Should preserve GitHub secrets syntax");
            assert.ok(result.includes("${{ env.AZURE_CONTAINER_REGISTRY }}"), "Should preserve GitHub env syntax");
            assert.ok(result.includes("${{ github.sha }}"), "Should preserve GitHub context syntax");
        });

        test("should generate valid YAML structure", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("name:"), "Should have name field");
            assert.ok(result.includes("on:"), "Should have on field");
            assert.ok(result.includes("env:"), "Should have env field");
            assert.ok(result.includes("jobs:"), "Should have jobs field");
            assert.ok(result.includes("buildImage:"), "Should have buildImage job");
            assert.ok(result.includes("deploy:"), "Should have deploy job");
        });
    });

    suite("validateWorkflowConfig", () => {
        test("should return no errors for valid configuration", () => {
            const errors = validateWorkflowConfig(validConfig);
            assert.strictEqual(errors.length, 0, "Valid config should have no errors");
        });

        test("should return error when workflow name is empty", () => {
            const config = { ...validConfig, workflowName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Workflow name")),
                "Should have workflow name error",
            );
        });

        test("should return error when branch name is empty", () => {
            const config = { ...validConfig, branchName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Branch name")),
                "Should have branch name error",
            );
        });

        test("should return error when container name is empty", () => {
            const config = { ...validConfig, containerName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Container name")),
                "Should have container name error",
            );
        });

        test("should return error when dockerfile path is empty", () => {
            const config = { ...validConfig, dockerFile: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Dockerfile path")),
                "Should have dockerfile path error",
            );
        });

        test("should return error when ACR name is empty", () => {
            const config = { ...validConfig, azureContainerRegistry: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Azure Container Registry")),
                "Should have ACR name error",
            );
        });

        test("should return error when cluster name is empty", () => {
            const config = { ...validConfig, clusterName: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Cluster name")),
                "Should have cluster name error",
            );
        });

        test("should return error when namespace is empty", () => {
            const config = { ...validConfig, namespace: "" };
            const errors = validateWorkflowConfig(config);
            assert.ok(errors.length > 0, "Should have validation errors");
            assert.ok(
                errors.some((e) => e.includes("Namespace")),
                "Should have namespace error",
            );
        });

        test("should return multiple errors for multiple invalid fields", () => {
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

    suite("Template Content", () => {
        test("should include buildImage job with correct steps", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("buildImage:"), "Should have buildImage job");
            assert.ok(result.includes("actions/checkout@v4"), "Should checkout code");
            assert.ok(result.includes("azure/login@v2"), "Should login to Azure");
            assert.ok(result.includes("az acr login"), "Should login to ACR");
            assert.ok(result.includes("az acr build"), "Should build and push image");
        });

        test("should include deploy job with correct dependencies", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("deploy:"), "Should have deploy job");
            assert.ok(result.includes("needs: [buildImage]"), "Should depend on buildImage");
        });

        test("should include kubelogin setup", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("azure/use-kubelogin@v1"), "Should use kubelogin action");
            assert.ok(result.includes("kubelogin-version"), "Should specify kubelogin version");
        });

        test("should include AKS context setup", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("azure/aks-set-context@v4"), "Should set AKS context");
            assert.ok(result.includes("use-kubelogin: 'true'"), "Should enable kubelogin");
        });

        test("should include deployment step", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("Azure/k8s-deploy@v5"), "Should use k8s-deploy action");
            assert.ok(result.includes("action: deploy"), "Should specify deploy action");
        });

        test("should handle private cluster checks", () => {
            const result = renderWorkflowTemplate(validConfig);

            assert.ok(result.includes("Is private cluster"), "Should check if cluster is private");
            assert.ok(result.includes("PRIVATE_CLUSTER"), "Should set PRIVATE_CLUSTER output");
        });
    });
});
