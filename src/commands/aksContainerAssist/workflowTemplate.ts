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
export function sanitizeJobId(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-");
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : `c-${cleaned || "container"}`;
}

/**
 * Sanitizes a name to a valid ACR / OCI image repository segment.
 * Image repos must be lowercase and only contain [a-z0-9._-]. Leading and
 * trailing separators are stripped; consecutive separators are collapsed.
 * Falls back to "container" if sanitization leaves the value empty.
 */
export function sanitizeImageName(name: string): string {
    const cleaned = name
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-._]+|[-._]+$/g, "");
    return cleaned.length > 0 ? cleaned : "container";
}

/**
 * Re-indents a literal/folded block scalar (one whose first line is `|` or
 * `>`) so its content lines are indented to `targetIndent` spaces. Plain
 * scalars are returned unchanged. Used to embed a manifest list under a
 * nested job env block where the default 8-space indentation produced by
 * `formatManifestPathForYamlBlock` would otherwise outdent the content and
 * produce invalid YAML.
 */
export function reindentBlockScalar(value: string, targetIndent: number): string {
    if (!value.startsWith("|") && !value.startsWith(">")) return value;
    const [header, ...rest] = value.split("\n");
    const pad = " ".repeat(targetIndent);
    const lines = rest.map((line) => {
        const trimmed = line.replace(/^\s+/, "");
        return trimmed.length === 0 ? "" : pad + trimmed;
    });
    return [header, ...lines].join("\n");
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
 * Loads a multi-container template fragment from resources/yaml/.
 * Throws if the file cannot be read.
 */
function loadMultiTemplate(templateName: string): string {
    const result = getWorkflowYaml(`${templateName}.template`);
    if (failed(result)) {
        throw new Error(result.error);
    }
    return result.result;
}

/**
 * Renders the matrix `include:` entries for the build job.
 * Each entry is indented to align under `strategy.matrix.include:` (20 spaces).
 */
function renderMatrixInclude(containers: ContainerJobConfig[]): string {
    return containers
        .map((c) => {
            const imageName = sanitizeImageName(c.containerName);
            const lines = [
                `                    - service: ${sanitizeJobId(c.containerName)}`,
                `                      docker_file: ${c.dockerFile}`,
                `                      build_context: ${c.buildContextPath}`,
                `                      image: ${imageName}`,
            ];
            return lines.join("\n");
        })
        .join("\n");
}

/**
 * Renders a per-container deploy job fragment by loading the appropriate
 * template file and performing placeholder substitution.
 */
function renderDeployJob(jobId: string, container: ContainerJobConfig, isManagedNamespace: boolean): string {
    const templateName = isManagedNamespace ? "workflow-multi-deploy-job-managed-ns" : "workflow-multi-deploy-job";
    let template = loadMultiTemplate(templateName);

    // The block scalar produced by formatManifestPathForYamlBlock is indented for
    // the top-level (4-space) env block used by the single-container template;
    // here the key sits at 12 spaces, so re-indent the content lines to 16
    // spaces to keep the YAML valid for multi-manifest configs.
    const rawManifestPath = container.deploymentManifestPath ?? "";
    const manifestPath = reindentBlockScalar(rawManifestPath, 16);
    const imageName = sanitizeImageName(container.containerName);

    const replacements: Record<string, string> = {
        "{ { DEPLOY_JOB_ID } }": `deploy-${jobId}`,
        "{ { CONTAINERNAME } }": imageName,
        "{ { DEPLOYMENTMANIFESTPATH } }": manifestPath,
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        template = template.replace(new RegExp(escapedPlaceholder, "g"), value);
    }

    return template;
}

/**
 * Renders a multi-container GitHub Actions workflow.
 *
 * Layout: one top-level workflow with shared `env:` for ACR/cluster/namespace,
 * a single `build` job using matrix strategy (one matrix entry per container),
 * then a `deploy-<name>` job per container that has a manifest path.
 * Containers without a `deploymentManifestPath` are built but not deployed.
 */
export function renderMultiContainerWorkflowTemplate(config: MultiContainerWorkflowConfig): string {
    // --- Header ---
    let header = loadMultiTemplate("workflow-multi-header");
    const headerReplacements: Record<string, string> = {
        "{ { WORKFLOWNAME } }": config.workflowName,
        "{ { BRANCHNAME } }": config.branchName,
        "{ { ACRRESOURCEGROUP } }": config.acrResourceGroup,
        "{ { AZURECONTAINERREGISTRY } }": config.azureContainerRegistry,
        "{ { CLUSTERNAME } }": config.clusterName,
        "{ { CLUSTERRESOURCEGROUP } }": config.clusterResourceGroup,
        "{ { NAMESPACE } }": config.namespace,
    };
    for (const [placeholder, value] of Object.entries(headerReplacements)) {
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        header = header.replace(new RegExp(escapedPlaceholder, "g"), value);
    }

    // --- Build job (matrix strategy) ---
    let buildJob = loadMultiTemplate("workflow-multi-build-job");
    const matrixInclude = renderMatrixInclude(config.containers);
    buildJob = buildJob.replace(/\{\s*\{\s*MATRIX_INCLUDE\s*\}\s*\}/g, matrixInclude);

    // --- Deploy jobs (one per container with a manifest) ---
    const deployJobs = config.containers
        .filter((container) => container.deploymentManifestPath)
        .map((container) => {
            const jobId = sanitizeJobId(container.containerName);
            return renderDeployJob(jobId, container, config.isManagedNamespace);
        })
        .join("\n");

    return `${header}${buildJob}\n${deployJobs}`;
}
