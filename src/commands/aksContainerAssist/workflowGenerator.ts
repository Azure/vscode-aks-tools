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
import {
    writeWorkflowFile,
    workflowFileExists,
    fileExists,
    scanForK8sManifests,
    scanForDockerfiles,
    getK8sManifestFolder,
} from "./fileOperations";
import { logger } from "./logger";
import type { AzureContext } from "./azureSelections";
import { ContainerAssistService } from "./containerAssistService";

/** Parameters for workflow generation, replacing positional arguments. */
export interface WorkflowGenerationOptions {
    workspaceFolder: vscode.WorkspaceFolder;
    projectRoot: string;
    azureContext: AzureContext;
    hasBothActions: boolean;
    /** Output from deployment generation, used to skip prompts and reuse known paths. */
    deploymentResult?: { manifestPaths?: string[]; primaryModuleName?: string };
}

/** Normalize a relative path to POSIX separators so GitHub Actions (Linux) can use it. */
function toPosixPath(p: string): string {
    return p.replace(/\\/g, "/");
}

export function generateGitHubWorkflow(options: WorkflowGenerationOptions): Promise<Errorable<string>> {
    return Promise.resolve(
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Generating GitHub workflow file..."),
                cancellable: false,
            },
            () => doGenerateGitHubWorkflow(options),
        ),
    );
}

async function doGenerateGitHubWorkflow(options: WorkflowGenerationOptions): Promise<Errorable<string>> {
    const { workspaceFolder, projectRoot, azureContext, hasBothActions, deploymentResult } = options;
    try {
        const workspaceRoot = workspaceFolder.uri.fsPath;
        const config = await collectWorkflowConfiguration(
            workspaceRoot,
            projectRoot,
            azureContext,
            hasBothActions,
            deploymentResult?.manifestPaths,
            deploymentResult?.primaryModuleName,
        );
        if (!config) {
            return { succeeded: false, error: "cancelled" };
        }

        // Validate configuration
        const validationErrors = validateWorkflowConfig(config);
        if (validationErrors.length > 0) {
            const errorMsg = validationErrors.join("; ");
            logger.error("Workflow configuration validation failed", errorMsg);
            return { succeeded: false, error: `Invalid configuration: ${errorMsg}` };
        }

        const workflowName = sanitizeWorkflowName(config.workflowName);
        const exists = await workflowFileExists(workspaceRoot, workflowName);
        if (exists) {
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Workflow file "{0}.yml" already exists. Overwrite?', workflowName),
                l10n.t("Overwrite"),
                l10n.t("Cancel"),
            );
            if (overwrite !== l10n.t("Overwrite")) {
                return { succeeded: false, error: "cancelled" };
            }
        }

        // Render template and write file
        const workflowContent = renderWorkflowTemplate(config);
        logger.debug("Workflow template rendered successfully");

        const workflowPath = await writeWorkflowFile(workspaceRoot, workflowName, workflowContent);

        vscode.window.showInformationMessage(
            l10n.t("GitHub workflow written to: {0}", path.relative(workspaceRoot, workflowPath) || workflowPath),
        );

        return { succeeded: true, result: workflowPath };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to generate workflow", error);
        return { succeeded: false, error: `Failed to generate workflow: ${errorMsg}` };
    }
}

async function collectWorkflowConfiguration(
    workspaceRoot: string,
    projectRoot: string,
    azureContext: AzureContext,
    hasBothActions: boolean,
    knownManifestPaths?: string[],
    primaryModuleName?: string,
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

    const appName = primaryModuleName ?? path.basename(projectRoot);

    // Search recursively; prefer the shallowest match for auto-selection.
    const detectedDockerfiles = await detectDockerfilePaths(projectRoot);
    const detectedDockerfile = detectedDockerfiles.length > 0 ? detectedDockerfiles[0] : undefined;

    let dockerfilePath: string | undefined;
    if (hasBothActions && detectedDockerfile) {
        dockerfilePath = detectedDockerfile;
        logger.debug("Dockerfile auto-detected (skipping prompt — deployment just generated)", dockerfilePath);
    } else {
        dockerfilePath = await promptForDockerfilePath(projectRoot, detectedDockerfiles);
    }
    if (!dockerfilePath) return undefined;
    logger.debug("Dockerfile path selected", dockerfilePath);

    // Build context: use the Dockerfile's directory when in a subdirectory, else ".".
    // Auto-derive when both actions were selected; otherwise prompt.
    let buildContextPath: string | undefined;
    const dockerfileDir = path.dirname(dockerfilePath);
    const defaultBuildContext = dockerfileDir !== "." ? dockerfileDir : ".";
    if (hasBothActions) {
        buildContextPath = defaultBuildContext;
        logger.debug("Build context auto-derived (skipping prompt — deployment just generated)", buildContextPath);
    } else {
        buildContextPath = await promptForBuildContext(defaultBuildContext);
    }
    if (!buildContextPath) return undefined;
    logger.debug("Build context path selected", buildContextPath);

    // Use known manifest paths from deployment (absolute) instead of re-scanning,
    // so manifests in module subdirectories are always found.
    let relativeManifests: string[];
    if (hasBothActions && knownManifestPaths && knownManifestPaths.length > 0) {
        relativeManifests = knownManifestPaths.map((p) => toPosixPath(path.relative(workspaceRoot, p)));
        logger.debug(
            `Using ${relativeManifests.length} known manifest path(s) from deployment generation`,
            relativeManifests,
        );
    } else {
        const detectedManifests = await detectK8sManifests(workspaceRoot, projectRoot);
        relativeManifests = detectedManifests.map((p) => toPosixPath(path.relative(workspaceRoot, p)));
    }

    const dockerfileRelToWorkspace = toPosixPath(
        path.relative(workspaceRoot, path.resolve(projectRoot, dockerfilePath)),
    );
    const buildContextRelToWorkspace =
        buildContextPath === "."
            ? toPosixPath(path.relative(workspaceRoot, projectRoot)) || "."
            : toPosixPath(path.relative(workspaceRoot, path.resolve(projectRoot, buildContextPath)));

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
        dockerFile: dockerfileRelToWorkspace,
        buildContextPath: buildContextRelToWorkspace,
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
 * Searches for Dockerfiles within the project directory (up to 3 levels deep).
 * Returns paths relative to projectRoot, shallowest first.
 * Returns an empty array if none are found.
 */
async function detectDockerfilePaths(projectRoot: string): Promise<string[]> {
    const absolutePaths = await scanForDockerfiles(projectRoot);
    return absolutePaths.map((p) => path.relative(projectRoot, p));
}

/**
 * Prompts user to select or confirm a Dockerfile path.
 * Shows a QuickPick when multiple Dockerfiles are detected; falls back to an
 * input box when none are found (so the user can type a custom path).
 */
async function promptForDockerfilePath(projectRoot: string, detectedPaths: string[]): Promise<string | undefined> {
    if (detectedPaths.length === 1) {
        // Single Dockerfile — present as pre-filled input box with validation
        const result = await vscode.window.showInputBox({
            prompt: l10n.t("Enter Dockerfile path (relative to project root)\n✓ Found: {0}", detectedPaths[0]),
            placeHolder: "Dockerfile",
            value: detectedPaths[0],
            title: l10n.t("Dockerfile Location"),
            ignoreFocusOut: true,
            validateInput: async (value) => {
                if (!value || value.trim() === "") {
                    return l10n.t("Dockerfile path is required");
                }
                if (value.startsWith("/") || value.includes("..")) {
                    return l10n.t("Dockerfile path must be a relative path within the project");
                }
                const fullPath = path.join(projectRoot, value);
                if (!(await fileExists(fullPath))) {
                    return l10n.t("Dockerfile not found at this path");
                }
                return undefined;
            },
        });
        return result?.trim();
    }

    if (detectedPaths.length > 1) {
        // Multiple Dockerfiles — let user pick from a QuickPick list
        const items: vscode.QuickPickItem[] = detectedPaths.map((p) => ({
            label: p,
            description: p === "Dockerfile" ? l10n.t("(repo root)") : undefined,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: l10n.t("Multiple Dockerfiles found — select one to use"),
            title: l10n.t("Dockerfile Location ({0} found)", detectedPaths.length),
            ignoreFocusOut: true,
        });
        return selected?.label;
    }

    // No Dockerfile found — free-text input box
    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter Dockerfile path (relative to project root)\nNot found - using default"),
        placeHolder: "Dockerfile",
        value: "Dockerfile",
        title: l10n.t("Dockerfile Location"),
        ignoreFocusOut: true,
        validateInput: async (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Dockerfile path is required");
            }
            if (value.startsWith("/") || value.includes("..")) {
                return l10n.t("Dockerfile path must be a relative path within the project");
            }
            const fullPath = path.join(projectRoot, value);
            if (!(await fileExists(fullPath))) {
                return l10n.t("Dockerfile not found at this path");
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
 * Detects Kubernetes manifests by scanning each module's <modulePath>/<k8sFolder>
 * (via analyzeRepo), matching where deployment generation writes them.
 * Falls back to a workspace-root scan if no modules or manifests are found.
 */
async function detectK8sManifests(workspaceRoot: string, projectRoot: string): Promise<string[]> {
    try {
        const service = new ContainerAssistService();
        const analysis = await service.analyzeRepository(projectRoot);
        if (analysis.succeeded && analysis.result.modules.length > 0) {
            const manifestFolder = getK8sManifestFolder();
            const scanRoots = new Set<string>();
            for (const module of analysis.result.modules) {
                scanRoots.add(path.join(module.modulePath, manifestFolder));
                scanRoots.add(module.modulePath);
            }

            const found = new Set<string>();
            for (const root of scanRoots) {
                const hits = await scanForK8sManifests(root);
                hits.forEach((p) => found.add(p));
            }

            if (found.size > 0) {
                return Array.from(found);
            }
        }
    } catch (error) {
        logger.error("Module-aware manifest detection failed; falling back to workspace-root scan", error);
    }

    return scanForK8sManifests(workspaceRoot);
}

/**
 * Sanitizes workflow name to be used as filename
 */
function sanitizeWorkflowName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
}
