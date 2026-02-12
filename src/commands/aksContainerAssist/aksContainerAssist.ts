import * as vscode from "vscode";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ContainerAssistService } from "./containerAssistService";
import { ContainerAssistAction, ContainerAssistQuickPickItem } from "./types";
import { failed } from "../utils/errorable";
import * as l10n from "@vscode/l10n";
import * as path from "path";
import { promises as fs } from "fs";
import { logger } from "./logger";
import { generateGitHubWorkflow } from "./workflowGenerator";
import { stageFilesAndCreatePR, isGitExtensionAvailable, isGitHubExtensionAvailable } from "./gitHubIntegration";

export async function runContainerAssist(_context: IActionContext, target: unknown): Promise<void> {
    try {
        logger.info("Container Assist command started");
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
        logger.info("Container Assist is available and enabled");

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
        logger.info(`Project root detected: ${projectRoot}`);

        const selectedActions = await showContainerAssistQuickPick();
        if (!selectedActions || selectedActions.length === 0) {
            logger.info("No actions selected, operation cancelled");
            return;
        }

        logger.info(`Selected actions: ${selectedActions.join(", ")}`);
        for (const action of selectedActions) {
            await processContainerAssistAction(action, containerAssistService, workspaceFolder, projectRoot);
        }

        logger.info("Container Assist command completed successfully");
    } catch (error) {
        logger.error("Unexpected error in Container Assist", error);
        vscode.window.showErrorMessage(
            l10n.t("Container Assist error: {0}", error instanceof Error ? error.message : String(error)),
        );
    }
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

async function showContainerAssistQuickPick(): Promise<ContainerAssistAction[] | undefined> {
    const items: ContainerAssistQuickPickItem[] = [
        {
            label: l10n.t("$(file) Generate Deployment Files"),
            description: l10n.t("Analyze → Generate Dockerfile → Generate Kubernetes Manifests"),
            action: ContainerAssistAction.GenerateDeployment,
            picked: false,
        },
        {
            label: l10n.t("$(github-action) Generate GitHub Workflow"),
            description: l10n.t("Create GitHub Actions workflow for CI/CD to AKS"),
            action: ContainerAssistAction.GenerateWorkflow,
            picked: false,
        },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: l10n.t("Select Container Assist actions to perform"),
        title: l10n.t("Container Assist for AKS Deployment"),
    });

    if (!selected || selected.length === 0) {
        return undefined;
    }

    return selected.map((item) => item.action);
}

async function processContainerAssistAction(
    action: ContainerAssistAction,
    service: ContainerAssistService,
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
): Promise<void> {
    switch (action) {
        case ContainerAssistAction.GenerateDeployment:
            await generateDeploymentFiles(service, workspaceFolder, targetPath);
            break;

        case ContainerAssistAction.GenerateWorkflow:
            await generateWorkflowFile(workspaceFolder, targetPath);
            break;

        default:
            logger.warn(`Unknown action: ${action}`);
            vscode.window.showWarningMessage(l10n.t("Unknown action: {0}", action));
    }
}

async function generateDeploymentFiles(
    service: ContainerAssistService,
    _workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
): Promise<void> {
    const appName = path.basename(targetPath);
    logger.info(`Starting deployment file generation for app: ${appName}`);
    logger.debug("Target path", targetPath);

    const useDefault = l10n.t("Use Default Model");
    const selectModel = l10n.t("Select Model...");
    const modelChoice = await vscode.window.showQuickPick([useDefault, selectModel], {
        placeHolder: l10n.t("Choose Language Model"),
        title: l10n.t("Container Assist - Language Model"),
    });

    if (!modelChoice) {
        logger.info("Model selection cancelled");
        return;
    }

    const showModelPicker = modelChoice === selectModel;

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t("Container Assist"),
            cancellable: true,
        },
        async (progress, token) => {
            const abortController = new AbortController();
            token.onCancellationRequested(() => {
                logger.info("Operation cancelled by user");
                abortController.abort();
            });

            try {
                progress.report({ message: l10n.t("Analyzing project {0}...", appName) });

                const generationResult = await service.generateDeploymentFiles(
                    targetPath,
                    appName,
                    abortController.signal,
                    token,
                    showModelPicker,
                    (step: string) => progress.report({ message: step }),
                );

                if (token.isCancellationRequested) {
                    return undefined;
                }

                progress.report({ message: l10n.t("Completing...") });
                return generationResult;
            } catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    logger.info("Operation was aborted");
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
        return;
    }

    if (failed(result)) {
        logger.error("Deployment file generation failed", result.error);
        vscode.window.showErrorMessage(l10n.t("Failed to generate deployment files: {0}", result.error));
        return;
    }

    const generatedFiles = result.result.generatedFiles;
    logger.info(`Successfully generated ${generatedFiles.length} files`);
    logger.debug("Generated files", generatedFiles);

    if (generatedFiles.length === 0) {
        logger.warn("No files were generated");
        vscode.window.showWarningMessage(l10n.t("No deployment files were generated."));
        return;
    }

    const message = l10n.t("Successfully generated {0} deployment files", generatedFiles.length);
    const openFiles = l10n.t("Open Files");
    const showLogs = l10n.t("Show Logs");
    const addToGit = l10n.t("Add to Git & Create PR");

    const selection = await vscode.window.showInformationMessage(message, openFiles, showLogs, addToGit);
    if (selection === openFiles) {
        await openGeneratedFiles(generatedFiles);
    } else if (selection === showLogs) {
        logger.show();
    } else if (selection === addToGit) {
        await handleGitHubIntegration(generatedFiles, _workspaceFolder, appName);
    }
}

async function openGeneratedFiles(files: string[]): Promise<void> {
    for (const file of files) {
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (error) {
            logger.error(`Failed to open file: ${file}`, error);
        }
    }
}

async function generateWorkflowFile(workspaceFolder: vscode.WorkspaceFolder, targetPath: string): Promise<void> {
    logger.info("Starting GitHub workflow generation");

    // No progress notification - just generate the workflow
    const result = await generateGitHubWorkflow(workspaceFolder, targetPath);

    if (failed(result)) {
        logger.error("GitHub workflow generation failed", result.error);
        vscode.window.showErrorMessage(l10n.t("Failed to generate GitHub workflow: {0}", result.error));
        return;
    }

    const workflowPath = result.result;
    logger.info(`GitHub workflow created at: ${workflowPath}`);

    // Show success message AFTER file is generated
    const message = l10n.t("Successfully generated GitHub workflow");
    const openFile = l10n.t("Open Workflow");
    const showLogs = l10n.t("Show Logs");

    const selection = await vscode.window.showInformationMessage(message, openFile, showLogs);
    if (selection === openFile) {
        const doc = await vscode.workspace.openTextDocument(workflowPath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } else if (selection === showLogs) {
        logger.show();
    }
}

async function handleGitHubIntegration(
    generatedFiles: string[],
    workspaceFolder: vscode.WorkspaceFolder,
    appName: string,
): Promise<void> {
    logger.info("Handling GitHub integration for generated files");

    // Check if Git extension is available
    const hasGit = await isGitExtensionAvailable();
    if (!hasGit) {
        const message = l10n.t(
            "Git extension is required for this feature. Please install or enable the Git extension.",
        );
        vscode.window.showWarningMessage(message);
        logger.warn(message);
        return;
    }

    // Check configuration
    const config = vscode.workspace.getConfiguration("aks.containerAssist");
    const enableGitHubIntegration = config.get<boolean>("enableGitHubIntegration", true);

    if (!enableGitHubIntegration) {
        logger.info("GitHub integration is disabled in settings");
        vscode.window.showInformationMessage(
            l10n.t(
                'GitHub integration is disabled. Enable it in settings: "aks.containerAssist.enableGitHubIntegration"',
            ),
        );
        return;
    }

    // Warn if GitHub extension is not available
    const hasGitHub = await isGitHubExtensionAvailable();
    if (!hasGitHub) {
        const message = l10n.t(
            "GitHub Pull Requests extension is recommended for creating PRs. Files will be staged, but you'll need to create the PR manually.",
        );
        logger.warn(message);
        // Continue anyway - we can still stage files
    }

    await stageFilesAndCreatePR(generatedFiles, workspaceFolder.uri, appName);
}
