import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ContainerAssistService } from "./containerAssistService";
import { ContainerAssistAction, ContainerAssistQuickPickItem } from "./types";
import { failed } from "../utils/errorable";
import * as l10n from "@vscode/l10n";
import * as path from "path";
import { promises as fs } from "fs";
import { logger } from "./logger";
import { generateGitHubWorkflow, WorkflowGenerationOptions } from "./workflowGenerator";

import { collectAzureContext, collectAzureContextFromTree, AzureContext } from "./azureSelections";
import { showPostGenerationOptions } from "./postGenerationFlow";
import { getAksClusterTreeNode } from "../utils/clusters";
import { selectLanguageModel } from "./lmClient";
import { showWizardExitConfirmation } from "./wizardUtils";
export { showWizardExitConfirmation } from "./wizardUtils";

export async function runContainerAssist(
    _context: IActionContext,
    target: unknown,
    defaultActions: ContainerAssistAction[] = [],
): Promise<void> {
    try {
        logger.debug("Command target", target);

        const targetUri = getTargetUri(target);
        if (!targetUri) {
            logger.warn("No valid target URI found");
            vscode.window.showErrorMessage(
                l10n.t("Please right-click on a folder or file in the explorer to use Container Assist."),
            );
            return;
        }
        logger.debug("Target URI", targetUri.fsPath);

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
        if (!workspaceFolder) {
            logger.warn("Target is not part of a workspace");
            vscode.window.showErrorMessage(l10n.t("The selected item is not part of a workspace."));
            return;
        }
        logger.debug("Workspace folder", workspaceFolder.uri.fsPath);

        const containerAssistService = new ContainerAssistService();
        const availabilityCheck = await containerAssistService.isAvailable();
        if (failed(availabilityCheck)) {
            logger.warn(`Not available: ${availabilityCheck.error}`);
            vscode.window.showErrorMessage(availabilityCheck.error);
            return;
        }

        let startPath = targetUri.fsPath;
        try {
            const stat = await fs.stat(startPath);
            if (stat.isFile()) {
                startPath = path.dirname(startPath);
                logger.debug("Target was a file, using parent directory", startPath);
            }
        } catch (error) {
            logger.error("Failed to stat target path", error);
            vscode.window.showErrorMessage(l10n.t("Failed to access the selected path."));
            return;
        }

        const projectRoot = await findProjectRoot(startPath, workspaceFolder.uri.fsPath);

        await executeContainerAssistActions(
            containerAssistService,
            workspaceFolder,
            projectRoot,
            (hasWorkflow) => collectAzureContext(hasWorkflow, projectRoot),
            defaultActions,
        );
    } catch (error) {
        logger.error("Unexpected error in Container Assist", error);
        vscode.window.showErrorMessage(
            l10n.t("Container Assist error: {0}", error instanceof Error ? error.message : String(error)),
        );
    }
}

/**
 * Runs Container Assist from the AKS cluster tree context menu.
 * Subscription and cluster are extracted from the tree node, so the user
 * is NOT prompted for those — only ACR, namespace, and workflow name are asked.
 */
export async function runContainerAssistFromTree(_context: IActionContext, target: unknown): Promise<void> {
    try {
        logger.debug("Container Assist from tree, target", target);

        // Step 1: Resolve the cluster tree node
        const cloudExplorer = await k8s.extension.cloudExplorer.v1;
        const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
        if (failed(clusterNode)) {
            vscode.window.showErrorMessage(clusterNode.error);
            return;
        }

        const { subscriptionId, resourceGroupName, name: clusterName } = clusterNode.result;
        logger.debug("Cluster from tree", { subscriptionId, resourceGroupName, clusterName });

        // Step 2: Determine workspace folder / project root
        const workspaceFolder = await pickWorkspaceFolder();
        if (!workspaceFolder) return;

        const projectRoot = await findProjectRoot(workspaceFolder.uri.fsPath, workspaceFolder.uri.fsPath);

        // Step 3: Check availability
        const containerAssistService = new ContainerAssistService();
        const availabilityCheck = await containerAssistService.isAvailable();
        if (failed(availabilityCheck)) {
            logger.warn(`Not available: ${availabilityCheck.error}`);
            vscode.window.showErrorMessage(availabilityCheck.error);
            return;
        }

        // Step 4: Execute shared action selection & processing logic
        await executeContainerAssistActions(containerAssistService, workspaceFolder, projectRoot, (hasWorkflow) =>
            collectAzureContextFromTree(subscriptionId, clusterName, resourceGroupName, hasWorkflow, projectRoot),
        );
    } catch (error) {
        logger.error("Unexpected error in Container Assist (from tree)", error);
        vscode.window.showErrorMessage(
            l10n.t("Container Assist error: {0}", error instanceof Error ? error.message : String(error)),
        );
    }
}

/**
 * Prompts the user to pick a workspace folder if multiple are open,
 * or uses the single workspace folder automatically.
 */
export async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage(
            l10n.t("No workspace folder found. Please open a folder to use Container Assist."),
        );
        return undefined;
    }

    if (folders.length === 1) {
        return folders[0];
    }

    const picked = await vscode.window.showWorkspaceFolderPick({
        placeHolder: l10n.t("Select workspace folder for Container Assist"),
    });

    if (!picked) {
        return showWizardExitConfirmation(() => pickWorkspaceFolder());
    }

    return picked;
}

function getTargetUri(target: unknown): vscode.Uri | undefined {
    if (target instanceof vscode.Uri) {
        return target;
    }

    if (typeof target === "object" && target !== null && "resourceUri" in target) {
        const resourceUri = (target as { resourceUri: unknown }).resourceUri;
        if (resourceUri instanceof vscode.Uri) {
            return resourceUri;
        }
    }

    return undefined;
}

async function findProjectRoot(startPath: string, workspaceRoot: string): Promise<string> {
    const projectIndicators = [
        "package.json",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "go.mod",
        "Cargo.toml",
        "requirements.txt",
        "setup.py",
        "pyproject.toml",
        ".csproj",
        ".sln",
    ];

    let currentPath = startPath;

    while (currentPath.startsWith(workspaceRoot)) {
        const extensionIndicators = projectIndicators.filter((ind) => ind.startsWith("."));
        if (extensionIndicators.length > 0) {
            try {
                const files = await fs.readdir(currentPath);
                const foundExtension = extensionIndicators.find((ext) => files.some((f) => f.endsWith(ext)));
                if (foundExtension) {
                    logger.debug(`Found project root at: ${currentPath} (indicator: *${foundExtension})`);
                    return currentPath;
                }
            } catch {
                // Ignore directory read errors
            }
        }

        const fileIndicators = projectIndicators.filter((ind) => !ind.startsWith("."));
        for (const indicator of fileIndicators) {
            try {
                await fs.access(path.join(currentPath, indicator));
                logger.debug(`Found project root at: ${currentPath} (indicator: ${indicator})`);
                return currentPath;
            } catch {
                // File doesn't exist, continue
            }
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            break;
        }
        currentPath = parentPath;
    }

    logger.debug(`No project root found, using original path: ${startPath}`);
    return startPath;
}

async function showContainerAssistQuickPick(
    defaultActions: ContainerAssistAction[] = [],
): Promise<ContainerAssistAction[] | undefined> {
    const deploymentPicked = defaultActions.includes(ContainerAssistAction.GenerateDeployment);
    const workflowPicked = defaultActions.includes(ContainerAssistAction.GenerateWorkflow);

    const items: ContainerAssistQuickPickItem[] = [
        {
            label: l10n.t("$(file) Generate Deployment Files"),
            description: l10n.t("Analyze → Generate Dockerfile → Generate Kubernetes Manifests"),
            action: ContainerAssistAction.GenerateDeployment,
            picked: deploymentPicked,
        },
        {
            label: l10n.t("$(github-action) Generate GitHub Workflow"),
            description: l10n.t("Create GitHub Actions workflow for CI/CD to AKS"),
            action: ContainerAssistAction.GenerateWorkflow,
            picked: workflowPicked,
        },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: l10n.t("Select Container Assist actions to perform"),
        title: l10n.t("Container Assist for AKS Deployment"),
    });

    if (!selected || selected.length === 0) {
        return showWizardExitConfirmation(() => showContainerAssistQuickPick());
    }

    return selected.map((item) => item.action);
}

/**
 * Shared logic for both runContainerAssist and runContainerAssistFromTree.
 * Handles action selection (QuickPick), model picker, Azure context collection,
 * action processing, and post-generation options.
 */
async function executeContainerAssistActions(
    containerAssistService: ContainerAssistService,
    workspaceFolder: vscode.WorkspaceFolder,
    projectRoot: string,
    azureContextProvider: (hasWorkflow: boolean) => Promise<AzureContext | undefined>,
    defaultActions: ContainerAssistAction[] = [],
): Promise<void> {
    const selectedActions = await showContainerAssistQuickPick(defaultActions);
    if (!selectedActions || selectedActions.length === 0) {
        return;
    }

    const hasDeployment = selectedActions.includes(ContainerAssistAction.GenerateDeployment);
    const hasWorkflow = selectedActions.includes(ContainerAssistAction.GenerateWorkflow);
    const hasBothActions = hasDeployment && hasWorkflow;

    if (hasDeployment) {
        const lmCheck = await containerAssistService.lmClient.selectModel(false);
        if (!lmCheck.succeeded) {
            vscode.window.showErrorMessage(lmCheck.error);
            return;
        }

        const modelResult = await selectLanguageModel(containerAssistService.lmClient);
        if (!modelResult) {
            return;
        }
    }

    const azureContext = await azureContextProvider(hasWorkflow);
    if (!azureContext) return;

    const workflowOptions: WorkflowGenerationOptions = { workspaceFolder, projectRoot, azureContext, hasBothActions };

    // When both actions are selected, workflow generation depends on deployment artifacts.
    // Run deployment first, and only proceed to workflow generation if Dockerfile + manifests exist.
    if (hasBothActions) {
        const deploymentResult = await processContainerAssistAction(
            ContainerAssistAction.GenerateDeployment,
            containerAssistService,
            workspaceFolder,
            projectRoot,
            true,
            azureContext,
        );

        const deploymentFiles = deploymentResult?.deploymentFiles ?? [];

        if (deploymentFiles.length === 0) {
            if (!deploymentResult) {
                return;
            }

            const existing = await containerAssistService.checkExistingFiles(projectRoot);
            if (!existing.hasDockerfile || !existing.hasK8sManifests) {
                logger.warn("Skipping workflow generation: deployment artifacts missing on disk");
                vscode.window.showErrorMessage(
                    l10n.t(
                        "Workflow generation requires a Dockerfile and Kubernetes manifests. Generate deployment files first, then try again.",
                    ),
                );
                return;
            }
        }

        const workflowResult = await generateWorkflowFile({
            ...workflowOptions,
            deploymentResult: deploymentResult ?? undefined,
        });

        if (!workflowResult?.workflowPath) {
            return;
        }

        const displayName = deploymentResult?.primaryModuleName ?? path.basename(projectRoot);
        const allFiles = [...deploymentFiles, workflowResult.workflowPath];
        await showPostGenerationOptions(allFiles, workspaceFolder, displayName, true, azureContext);
        return;
    }

    // Single-action flow
    await processContainerAssistAction(
        selectedActions[0],
        containerAssistService,
        workspaceFolder,
        projectRoot,
        false,
        azureContext,
    );
}

interface ActionResult {
    deploymentFiles?: string[];
    workflowPath?: string;
    /** Absolute paths to any generated Kubernetes manifests (populated by GenerateDeployment). */
    manifestPaths?: string[];
    /** Primary module name from SDK analysis (e.g. package.json "name"). */
    primaryModuleName?: string;
}

async function processContainerAssistAction(
    action: ContainerAssistAction,
    service: ContainerAssistService,
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
    hasBothActions: boolean,
    azureContext: AzureContext,
): Promise<ActionResult | undefined> {
    switch (action) {
        case ContainerAssistAction.GenerateDeployment:
            return await generateDeploymentFiles(service, workspaceFolder, targetPath, hasBothActions, azureContext);

        case ContainerAssistAction.GenerateWorkflow:
            return await generateWorkflowFile({
                workspaceFolder,
                projectRoot: targetPath,
                azureContext,
                hasBothActions,
            });

        default:
            logger.warn(`Unknown action: ${action}`);
            vscode.window.showWarningMessage(l10n.t("Unknown action: {0}", action));
            return undefined;
    }
}

async function generateDeploymentFiles(
    service: ContainerAssistService,
    _workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
    hasBothActions: boolean,
    azureContext: AzureContext,
): Promise<ActionResult | undefined> {
    const displayName = path.basename(targetPath);
    logger.debug("Target path", targetPath);

    const acrLoginServer = `${azureContext.acrName}.azurecr.io`;

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t("Container Assist"),
            cancellable: true,
        },
        async (progress, token) => {
            const abortController = new AbortController();
            token.onCancellationRequested(() => {
                abortController.abort();
            });

            try {
                progress.report({ message: l10n.t("Analyzing project {0}...", displayName) });

                const generationResult = await service.generateDeploymentFiles(
                    targetPath,
                    acrLoginServer,
                    azureContext.namespace,
                    abortController.signal,
                    token,
                    (step: string) => progress.report({ message: step }),
                );

                if (token.isCancellationRequested) {
                    return undefined;
                }

                progress.report({ message: l10n.t("Completing...") });
                return generationResult;
            } catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    return undefined;
                }
                logger.error("Exception during deployment file generation", error);
                vscode.window.showErrorMessage(
                    l10n.t("An error occurred while generating deployment files: {0}", String(error)),
                );
                return undefined;
            }
        },
    );

    if (!result) {
        return undefined;
    }

    if (failed(result)) {
        logger.error("Deployment file generation failed", result.error);
        vscode.window.showErrorMessage(l10n.t("Failed to generate deployment files: {0}", result.error));
        return undefined;
    }

    const generatedFiles = result.result.generatedFiles;
    logger.debug("Generated files", generatedFiles);

    if (generatedFiles.length === 0) {
        if (hasBothActions) {
            logger.debug("No new deployment files generated (files may already exist)");
            return { deploymentFiles: [] };
        }
        logger.warn("No files were generated");
        vscode.window.showWarningMessage(l10n.t("No deployment files were generated."));
        return undefined;
    }

    // Defer post-generation options when both actions are selected
    if (hasBothActions) {
        return {
            deploymentFiles: generatedFiles,
            manifestPaths: result.result.manifestPaths,
            primaryModuleName: result.result.primaryModuleName,
        };
    }

    // Show options only for deployment files
    await showPostGenerationOptions(generatedFiles, _workspaceFolder, displayName, false);
    return { deploymentFiles: generatedFiles };
}

async function generateWorkflowFile(options: WorkflowGenerationOptions): Promise<ActionResult | undefined> {
    const { workspaceFolder, projectRoot, hasBothActions, deploymentResult } = options;
    const result = await generateGitHubWorkflow(options);

    if (failed(result)) {
        if (result.error === "cancelled") {
            logger.debug("Workflow generation cancelled by user");
            return undefined;
        }
        logger.error("GitHub workflow generation failed", result.error);
        vscode.window.showErrorMessage(l10n.t("Failed to generate GitHub workflow: {0}", result.error));
        return undefined;
    }

    const workflowPath = result.result;

    // Defer post-generation options when both actions are selected
    if (hasBothActions) {
        return { workflowPath };
    }

    const displayName = deploymentResult?.primaryModuleName ?? path.basename(projectRoot);
    await showPostGenerationOptions([workflowPath], workspaceFolder, displayName, true, options.azureContext);

    return { workflowPath };
}
