/**
 * GitHub Actions workflow template for AKS deployment
 * This module is independent of the Container Assist SDK and handles workflow file generation
 */

import * as vscode from "vscode";
import { Errorable, failed } from "../utils/errorable";
import { getWorkflowYaml } from "../utils/configureWorkflowHelper";

export interface WorkflowConfig {
    // Workflow metadata
    workflowName: string;
    branchName: string;

    // Container configuration
    containerName: string;
    dockerFile: string;
    buildContextPath: string;

    // ACR configuration
    acrResourceGroup: string;
    azureContainerRegistry: string;

    // Cluster configuration
    clusterName: string;
    clusterResourceGroup: string;

    // Deployment configuration
    deploymentManifestPath: string;
    namespace: string;
    isManagedNamespace: boolean;
}

/**
 * Container assistance mode for workflow generation.
 * - Single: one Dockerfile and one workflow (existing behavior).
 * - Multi: multiple Dockerfiles, one workflow file with a build+deploy job pair per container.
 */
export enum ContainerMode {
    Single = "single",
    Multi = "multi",
}

/** Per-service configuration used to render one build+deploy job pair. */
export interface ContainerJobConfig {
    /** Logical service name (used as job-id prefix and CONTAINER_NAME). */
    containerName: string;
    /** Dockerfile path relative to the build context. */
    dockerFile: string;
    /** Build context path relative to the workspace root. */
    buildContextPath: string;
    /**
     * Deployment manifest path expression (a single path, glob, or YAML block
     * scalar produced by formatManifestPathForYamlBlock). Optional — when
     * omitted (e.g. user picked "Skip" in the manifest dialog), no deploy job
     * is generated for this container.
     */
    deploymentManifestPath?: string;
}

/** Shared/workflow-level configuration for a multi-container workflow. */
export interface MultiContainerWorkflowConfig {
    workflowName: string;
    branchName: string;
    acrResourceGroup: string;
    azureContainerRegistry: string;
    clusterName: string;
    clusterResourceGroup: string;
    namespace: string;
    isManagedNamespace: boolean;
    containers: ContainerJobConfig[];
}

/**
 * Loads the workflow template from the YAML file
 * @param isManagedNamespace Whether to load the managed namespace variant
 * @returns The workflow template content
 */
function loadWorkflowTemplate(isManagedNamespace: boolean): Errorable<string> {
    const templateName = isManagedNamespace ? "aks-deploy-managed-ns.template" : "aks-deploy.template";
    const templateContent = getWorkflowYaml(templateName);
    if (failed(templateContent)) {
        vscode.window.showErrorMessage(templateContent.error);
        return { succeeded: false, error: templateContent.error };
    }

    return { succeeded: true, result: templateContent.result };
}

/**
 * Renders the workflow template with provided configuration
 * @param config Workflow configuration
 * @returns Rendered workflow YAML content
 */
export function renderWorkflowTemplate(config: WorkflowConfig): string {
    const templateResult = loadWorkflowTemplate(config.isManagedNamespace);
    if (failed(templateResult)) {
        throw new Error(templateResult.error);
    }

    let rendered = templateResult.result;

    // Replace all template variables with their values
    const replacements: Record<string, string> = {
        "{ { WORKFLOWNAME } }": config.workflowName,
        "{ { BRANCHNAME } }": config.branchName,
        "{ { CONTAINERNAME } }": config.containerName,
        "{ { DOCKERFILE } }": config.dockerFile,
        "{ { BUILDCONTEXTPATH } }": config.buildContextPath,
        "{ { ACRRESOURCEGROUP } }": config.acrResourceGroup,
        "{ { AZURECONTAINERREGISTRY } }": config.azureContainerRegistry,
        "{ { CLUSTERNAME } }": config.clusterName,
        "{ { CLUSTERRESOURCEGROUP } }": config.clusterResourceGroup,
        "{ { DEPLOYMENTMANIFESTPATH } }": config.deploymentManifestPath,
        "{ { NAMESPACE } }": config.namespace,
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
        // Escape special regex characters in the placeholder
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rendered = rendered.replace(new RegExp(escapedPlaceholder, "g"), value);
    }

    // Check for any unreplaced placeholders and throw an error if found
    const unreplacedPlaceholders = rendered.match(/\{\s*\{\s*[A-Z_]+\s*\}\s*\}/g);
    if (unreplacedPlaceholders && unreplacedPlaceholders.length > 0) {
        throw new Error(`Template contains unreplaced placeholders: ${unreplacedPlaceholders.join(", ")}`);
    }

    return rendered;
}

/**
 * Validates workflow configuration
 * @param config Workflow configuration to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateWorkflowConfig(config: WorkflowConfig): string[] {
    const errors: string[] = [];

    if (!config.workflowName || config.workflowName.trim() === "") {
        errors.push("Workflow name is required");
    }

    if (!config.branchName || config.branchName.trim() === "") {
        errors.push("Branch name is required");
    }

    if (!config.containerName || config.containerName.trim() === "") {
        errors.push("Container name is required");
    }

    if (!config.dockerFile || config.dockerFile.trim() === "") {
        errors.push("Dockerfile path is required");
    }

    if (!config.buildContextPath || config.buildContextPath.trim() === "") {
        errors.push("Build context path is required");
    }

    if (!config.azureContainerRegistry || config.azureContainerRegistry.trim() === "") {
        errors.push("Azure Container Registry name is required");
    }

    if (!config.acrResourceGroup || config.acrResourceGroup.trim() === "") {
        errors.push("ACR resource group is required");
    }

    if (!config.clusterName || config.clusterName.trim() === "") {
        errors.push("Cluster name is required");
    }

    if (!config.clusterResourceGroup || config.clusterResourceGroup.trim() === "") {
        errors.push("Cluster resource group is required");
    }

    if (!config.deploymentManifestPath || config.deploymentManifestPath.trim() === "") {
        errors.push("Deployment manifest path is required");
    }

    if (!config.namespace || config.namespace.trim() === "") {
        errors.push("Namespace is required");
    }

    return errors;
}

/**
 * Sanitizes a name to a valid GitHub Actions job-id segment.
 * Job IDs must start with a letter/underscore and contain only [A-Za-z0-9_-].
 */
function sanitizeJobId(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-");
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : `c-${cleaned || "container"}`;
}

/**
 * Validates a multi-container workflow configuration.
 * Returns an array of error messages (empty if valid).
 */
export function validateMultiContainerWorkflowConfig(config: MultiContainerWorkflowConfig): string[] {
    const errors: string[] = [];

    if (!config.workflowName || config.workflowName.trim() === "") errors.push("Workflow name is required");
    if (!config.branchName || config.branchName.trim() === "") errors.push("Branch name is required");
    if (!config.azureContainerRegistry || config.azureContainerRegistry.trim() === "") {
        errors.push("Azure Container Registry name is required");
    }
    if (!config.acrResourceGroup || config.acrResourceGroup.trim() === "") {
        errors.push("ACR resource group is required");
    }
    if (!config.clusterName || config.clusterName.trim() === "") errors.push("Cluster name is required");
    if (!config.clusterResourceGroup || config.clusterResourceGroup.trim() === "") {
        errors.push("Cluster resource group is required");
    }
    if (!config.namespace || config.namespace.trim() === "") errors.push("Namespace is required");

    if (!config.containers || config.containers.length === 0) {
        errors.push("At least one container must be selected");
        return errors;
    }

    const seen = new Set<string>();
    for (const [i, c] of config.containers.entries()) {
        const label = c.containerName || `container[${i}]`;
        if (!c.containerName || c.containerName.trim() === "") errors.push(`Container name is required (index ${i})`);
        if (!c.dockerFile || c.dockerFile.trim() === "") errors.push(`Dockerfile path is required for "${label}"`);
        if (!c.buildContextPath || c.buildContextPath.trim() === "") {
            errors.push(`Build context path is required for "${label}"`);
        }
        const id = sanitizeJobId(c.containerName || "");
        if (seen.has(id)) errors.push(`Duplicate container job id derived from "${label}"`);
        seen.add(id);
    }

    return errors;
}

/**
 * Build the per-container build job YAML fragment.
 * Indented with 4 spaces (matching the existing single-container template style).
 */
function renderBuildJob(jobId: string, container: ContainerJobConfig): string {
    return `    build-${jobId}:
        permissions:
            contents: read
            id-token: write
        runs-on: ubuntu-latest
        env:
            CONTAINER_NAME: ${container.containerName}
            DOCKER_FILE: ${container.dockerFile}
            BUILD_CONTEXT_PATH: ${container.buildContextPath}
        steps:
            - uses: actions/checkout@v4

            - name: Azure login
              uses: azure/login@v2
              with:
                  client-id: \${{ secrets.AZURE_CLIENT_ID }}
                  tenant-id: \${{ secrets.AZURE_TENANT_ID }}
                  subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

            - name: Log into ACR
              run: |
                  az acr login -n \${{ env.AZURE_CONTAINER_REGISTRY }}

            - name: Build and push image to ACR
              run: |
                  az acr build --image \${{ env.AZURE_CONTAINER_REGISTRY }}.azurecr.io/\${{ env.CONTAINER_NAME }}:\${{ github.sha }} --registry \${{ env.AZURE_CONTAINER_REGISTRY }} -g \${{ env.ACR_RESOURCE_GROUP }} -f \${{ env.DOCKER_FILE }} \${{ env.BUILD_CONTEXT_PATH }}
`;
}

/** Per-container deploy job YAML fragment (standard, non-managed namespace path). */
function renderDeployJob(jobId: string, container: ContainerJobConfig, isManagedNamespace: boolean): string {
    const manifestPath = container.deploymentManifestPath ?? "";
    const contextStep = isManagedNamespace
        ? `            - name: Get K8s context (managed namespace)
              run: |
                  az aks namespace get-credentials \\
                    --name \${{ env.NAMESPACE }} \\
                    --resource-group \${{ env.CLUSTER_RESOURCE_GROUP }} \\
                    --cluster-name \${{ env.CLUSTER_NAME }} \\
                    --file "\${{ runner.temp }}/kubeconfig" \\
                    --overwrite-existing

                  kubelogin convert-kubeconfig \\
                    -l azurecli \\
                    --kubeconfig "\${{ runner.temp }}/kubeconfig"

                  echo "KUBECONFIG=\${{ runner.temp }}/kubeconfig" >> $GITHUB_ENV
`
        : `            - name: Get K8s context
              uses: azure/aks-set-context@v4
              with:
                  resource-group: \${{ env.CLUSTER_RESOURCE_GROUP }}
                  cluster-name: \${{ env.CLUSTER_NAME }}
                  admin: "false"
                  use-kubelogin: "true"
`;

    return `    deploy-${jobId}:
        permissions:
            actions: read
            contents: read
            id-token: write
        runs-on: ubuntu-latest
        needs: [build-${jobId}]
        env:
            CONTAINER_NAME: ${container.containerName}
            DEPLOYMENT_MANIFEST_PATH: ${manifestPath}
        steps:
            - uses: actions/checkout@v4

            - name: Azure login
              uses: azure/login@v2
              with:
                  client-id: \${{ secrets.AZURE_CLIENT_ID }}
                  tenant-id: \${{ secrets.AZURE_TENANT_ID }}
                  subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

            - name: Set up kubelogin for non-interactive login
              uses: azure/use-kubelogin@v1
              with:
                  kubelogin-version: "v0.0.25"

${contextStep}
            - name: Deploys application
              uses: Azure/k8s-deploy@v5
              with:
                  action: deploy
                  manifests: \${{ env.DEPLOYMENT_MANIFEST_PATH }}
                  images: |
                      \${{ env.AZURE_CONTAINER_REGISTRY }}.azurecr.io/\${{ env.CONTAINER_NAME }}:\${{ github.sha }}
                  namespace: \${{ env.NAMESPACE }}

            - name: Annotate deployment
              run: |
                  if kubectl get deployment -n \${{ env.NAMESPACE }} --no-headers 2>/dev/null | grep -q .; then
                    kubectl annotate deployment --all -n \${{ env.NAMESPACE }} \\
                      aks-project/pipeline-repo="\${{ github.repository }}" \\
                      aks-project/pipeline-workflow="\${{ github.workflow }}" \\
                      aks-project/deployed-by="vscode" \\
                      aks-project/pipeline-run-url="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}" \\
                      --overwrite
                  fi
`;
}

/**
 * Renders a multi-container GitHub Actions workflow.
 *
 * Layout: one top-level workflow with shared `env:` for ACR/cluster/namespace,
 * then a `build-<name>` + `deploy-<name>` job pair per selected container.
 * Containers without a `deploymentManifestPath` are built but not deployed.
 */
export function renderMultiContainerWorkflowTemplate(config: MultiContainerWorkflowConfig): string {
    const header = `# This workflow was generated by the AKS VS Code Extension (multi-container).
#
# 🔐 IMPORTANT: OIDC Authentication Required!
# Configure the following GitHub repository secrets before running:
#    - AZURE_CLIENT_ID
#    - AZURE_TENANT_ID
#    - AZURE_SUBSCRIPTION_ID
#
name: ${config.workflowName}

on:
    push:
        branches: [${config.branchName}]
    workflow_dispatch:

env:
    ACR_RESOURCE_GROUP: ${config.acrResourceGroup}
    AZURE_CONTAINER_REGISTRY: ${config.azureContainerRegistry}
    CLUSTER_NAME: ${config.clusterName}
    CLUSTER_RESOURCE_GROUP: ${config.clusterResourceGroup}
    NAMESPACE: ${config.namespace}

jobs:
`;

    const jobs = config.containers
        .map((container) => {
            const jobId = sanitizeJobId(container.containerName);
            const build = renderBuildJob(jobId, container);
            const deploy = container.deploymentManifestPath
                ? renderDeployJob(jobId, container, config.isManagedNamespace)
                : "";
            return deploy ? `${build}\n${deploy}` : build;
        })
        .join("\n");

    return `${header}${jobs}`;
}
