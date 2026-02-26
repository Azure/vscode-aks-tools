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
