/**
 * GitHub Workflow Generator for AKS deployments
 * This module handles the generation of GitHub Actions workflows for building and deploying to AKS
 * Independent of Container Assist SDK
 */

import * as vscode from "vscode";
import * as path from "path";
import * as l10n from "@vscode/l10n";
import { Errorable } from "../utils/errorable";
import { WorkflowConfig, renderWorkflowTemplate, validateWorkflowConfig } from "./workflowTemplate";
import { writeWorkflowFile, workflowFileExists, fileExists, scanForK8sManifests } from "./fileOperations";
import { logger } from "./logger";
import type { AzureContext } from "./azureSelections";

export async function generateGitHubWorkflow(
    workspaceFolder: vscode.WorkspaceFolder,
    projectRoot: string,
    azureContext: AzureContext,
    hasBothActions: boolean,
): Promise<Errorable<string>> {
    try {
        const config = await collectWorkflowConfiguration(workspaceFolder, projectRoot, azureContext, hasBothActions);
        if (!config) {
            return { succeeded: false, error: "Workflow generation cancelled" };
        }

        // Validate configuration
        const validationErrors = validateWorkflowConfig(config);
        if (validationErrors.length > 0) {
            const errorMsg = validationErrors.join("; ");
            logger.error("Workflow configuration validation failed", errorMsg);
            return { succeeded: false, error: `Invalid configuration: ${errorMsg}` };
        }

        // Check if workflow already exists
        const workflowName = sanitizeWorkflowName(config.workflowName);
        const exists = await workflowFileExists(projectRoot, workflowName);
        if (exists) {
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Workflow file "{0}.yaml" already exists. Overwrite?', workflowName),
                l10n.t("Overwrite"),
                l10n.t("Cancel"),
            );
            if (overwrite !== l10n.t("Overwrite")) {
                return { succeeded: false, error: "Workflow file already exists" };
            }
        }

        // Render template and write file
        const workflowContent = renderWorkflowTemplate(config);
        logger.debug("Workflow template rendered successfully");

        const workflowPath = await writeWorkflowFile(projectRoot, workflowName, workflowContent);

        return { succeeded: true, result: workflowPath };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to generate workflow", error);
        return { succeeded: false, error: `Failed to generate workflow: ${errorMsg}` };
    }
}

async function collectWorkflowConfiguration(
    _workspaceFolder: vscode.WorkspaceFolder,
    projectRoot: string,
    azureContext: AzureContext,
    hasBothActions: boolean,
): Promise<WorkflowConfig | undefined> {
    const {
        clusterName,
        clusterResourceGroup,
        acrName,
        acrResourceGroup,
        namespace,
        isManagedNamespace,
        workflowName,
    } = azureContext;
    if (!clusterName || !clusterResourceGroup || !namespace || !workflowName) {
        logger.error("collectWorkflowConfiguration called with incomplete Azure context");
        return undefined;
    }

    // Smart defaults for remaining values
    const appName = path.basename(projectRoot);

    // Dockerfile path - auto-detect or prompt user
    const detectedDockerfile = await detectDockerfilePath(projectRoot);
    let dockerfilePath: string | undefined;
    if (hasBothActions && detectedDockerfile) {
        dockerfilePath = detectedDockerfile;
        logger.debug("Dockerfile auto-detected (skipping prompt — deployment just generated)", dockerfilePath);
    } else {
        dockerfilePath = await promptForDockerfilePath(projectRoot, detectedDockerfile);
    }
    if (!dockerfilePath) return undefined;
    logger.debug("Dockerfile path selected", dockerfilePath);

    // Build context: auto-derive when deployment was just generated, otherwise prompt
    let buildContextPath: string | undefined;
    const defaultBuildContext = dockerfilePath.includes("/") ? path.dirname(dockerfilePath) : ".";
    if (hasBothActions && detectedDockerfile) {
        buildContextPath = defaultBuildContext;
        logger.debug("Build context auto-derived (skipping prompt — deployment just generated)", buildContextPath);
    } else {
        buildContextPath = await promptForBuildContext(defaultBuildContext);
    }
    if (!buildContextPath) return undefined;
    logger.debug("Build context path selected", buildContextPath);

    // Manifests: auto-select all when deployment was just generated, otherwise prompt
    const detectedManifests = await scanForK8sManifests(projectRoot);
    const relativeManifests = detectedManifests.map((p) => path.relative(projectRoot, p));

    let selectedManifests: string[] | undefined;
    if (hasBothActions && relativeManifests.length > 0) {
        selectedManifests = relativeManifests;
        logger.debug(
            `Auto-selected ${selectedManifests.length} manifest(s) (skipping prompt — deployment just generated)`,
            selectedManifests,
        );
    } else {
        selectedManifests = await promptForManifestSelection(relativeManifests);
    }
    if (!selectedManifests) return undefined;
    const manifestPath = formatManifestPathForYamlBlock(selectedManifests);
    logger.debug("Manifest paths selected", selectedManifests);

    return {
        workflowName,
        branchName: "main", // Default to main
        containerName: appName, // Use app name as container name
        dockerFile: dockerfilePath,
        buildContextPath,
        acrResourceGroup,
        azureContainerRegistry: acrName,
        clusterName,
        clusterResourceGroup,
        deploymentManifestPath: manifestPath,
        namespace,
        isManagedNamespace: isManagedNamespace ?? false,
    };
}

/**
 * Detects Dockerfile path in the project
 * Returns "Dockerfile" if it exists at the root, otherwise undefined
 */
async function detectDockerfilePath(projectRoot: string): Promise<string | undefined> {
    const dockerfilePath = path.join(projectRoot, "Dockerfile");
    if (await fileExists(dockerfilePath)) {
        return "Dockerfile";
    }
    return undefined;
}

/**
 * Prompts user to enter or confirm Dockerfile path
 */
async function promptForDockerfilePath(
    projectRoot: string,
    detectedPath: string | undefined,
): Promise<string | undefined> {
    const defaultPath = detectedPath || "Dockerfile";
    const detectionNote = detectedPath ? l10n.t("✓ Found: {0}", detectedPath) : l10n.t("Not found - using default");

    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter Dockerfile path (relative to project root)\n{0}", detectionNote),
        placeHolder: "Dockerfile",
        value: defaultPath,
        title: l10n.t("Dockerfile Location"),
        ignoreFocusOut: true,
        validateInput: async (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Dockerfile path is required");
            }
            // Optional: Validate file exists
            const fullPath = path.join(projectRoot, value);
            if (!(await fileExists(fullPath))) {
                return l10n.t("⚠ Warning: Dockerfile not found at this path");
            }
            return undefined;
        },
    });

    return result?.trim();
}

/**
 * Prompts user to enter build context path
 */
async function promptForBuildContext(defaultContext: string): Promise<string | undefined> {
    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter build context path (directory containing source code)"),
        placeHolder: ".",
        value: defaultContext,
        title: l10n.t("Build Context"),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Build context path is required");
            }
            // Validate it's a valid relative path
            if (value.startsWith("/") || value.includes("..")) {
                return l10n.t("Build context must be a relative path within the project");
            }
            return undefined;
        },
    });

    return result?.trim();
}

/**
 * Prompts user to select Kubernetes manifest files from a multi-select dropdown.
 * Detected manifests are pre-selected. User can also type a custom path.
 */
async function promptForManifestSelection(detectedPaths: string[]): Promise<string[] | undefined> {
    if (detectedPaths.length === 0) {
        // No manifests detected — fall back to a simple input box
        const result = await vscode.window.showInputBox({
            prompt: l10n.t("No manifests detected. Enter Kubernetes manifest path (relative to repo root)"),
            placeHolder: "k8s/deployment.yaml",
            value: "k8s/deployment.yaml",
            title: l10n.t("Kubernetes Manifests"),
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim() === "") {
                    return l10n.t("At least one manifest path is required");
                }
                return undefined;
            },
        });
        return result ? [result.trim()] : undefined;
    }

    const items: vscode.QuickPickItem[] = detectedPaths.map((p) => ({
        label: p,
        picked: true,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: l10n.t("Select Kubernetes manifests to include in the workflow"),
        title: l10n.t("Kubernetes Manifests ({0} detected)", detectedPaths.length),
        ignoreFocusOut: true,
    });

    if (!selected || selected.length === 0) return undefined;
    return selected.map((item) => item.label);
}

function formatManifestPathForYamlBlock(manifests: string[]): string {
    if (manifests.length === 1) {
        return manifests[0];
    }
    return `|\n${manifests.map((manifest) => `        ${manifest}`).join("\n")}`;
}
/**
 * Sanitizes workflow name to be used as filename
 */
function sanitizeWorkflowName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
}
