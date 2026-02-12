/**
 * GitHub Actions workflow template for AKS deployment
 * This module is independent of the Container Assist SDK and handles workflow file generation
 */

import * as fs from "fs";
import * as path from "path";

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
}

/**
 * Loads the workflow template from the YAML file
 * @returns The workflow template content
 */
function loadWorkflowTemplate(): string {
    const templatePath = path.join(__dirname, "aks-deploy.template.yaml");
    return fs.readFileSync(templatePath, "utf-8");
}

/**
 * Renders the workflow template with provided configuration
 * @param config Workflow configuration
 * @returns Rendered workflow YAML content
 */
export function renderWorkflowTemplate(config: WorkflowConfig): string {
    let rendered = loadWorkflowTemplate();

    // Replace all template variables with their values
    const replacements: Record<string, string> = {
        "{{WORKFLOWNAME}}": config.workflowName,
        "{{BRANCHNAME}}": config.branchName,
        "{{CONTAINERNAME}}": config.containerName,
        "{{DOCKERFILE}}": config.dockerFile,
        "{{BUILDCONTEXTPATH}}": config.buildContextPath,
        "{{ACRRESOURCEGROUP}}": config.acrResourceGroup,
        "{{AZURECONTAINERREGISTRY}}": config.azureContainerRegistry,
        "{{CLUSTERNAME}}": config.clusterName,
        "{{CLUSTERRESOURCEGROUP}}": config.clusterResourceGroup,
        "{{DEPLOYMENTMANIFESTPATH}}": config.deploymentManifestPath,
        "{{NAMESPACE}}": config.namespace,
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
        rendered = rendered.replace(new RegExp(placeholder, "g"), value);
    }

    // Check for any unreplaced placeholders and throw an error if found
    const unreplacedPlaceholders = rendered.match(/{{[A-Z_]+}}/g);
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
