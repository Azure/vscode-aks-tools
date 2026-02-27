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
import { setupOIDCForGitHub } from "./oidcSetup";
import { collectAzureContext, AzureContext } from "./azureSelections";

async function promptForModelChoice(): Promise<boolean | undefined> {
    const useDefault = l10n.t("Use Default Model");
    const selectModel = l10n.t("Select Model...");
    const modelChoice = await vscode.window.showQuickPick([useDefault, selectModel], {
        placeHolder: l10n.t("Choose Language Model"),
        title: l10n.t("Container Assist - Language Model"),
    });
    if (!modelChoice) {
        return undefined;
    }
    return modelChoice === selectModel;
}

export async function runContainerAssist(_context: IActionContext, target: unknown): Promise<void> {
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

        const selectedActions = await showContainerAssistQuickPick();
        if (!selectedActions || selectedActions.length === 0) {
            return;
        }

        // Determine which actions are selected
        const hasDeployment = selectedActions.includes(ContainerAssistAction.GenerateDeployment);
        const hasWorkflow = selectedActions.includes(ContainerAssistAction.GenerateWorkflow);
        const hasBothActions = hasDeployment && hasWorkflow;

        let showModelPicker: boolean | undefined;
        if (hasDeployment) {
            showModelPicker = await promptForModelChoice();
            if (showModelPicker === undefined) return;
        }

        // Collect Azure context upfront for all actions
        const azureContext = await collectAzureContext(hasWorkflow, projectRoot);
        if (!azureContext) return;

        const generatedFiles: string[] = [];
        let workflowPath: string | undefined;

        for (const action of selectedActions) {
            const result = await processContainerAssistAction(
                action,
                containerAssistService,
                workspaceFolder,
                projectRoot,
                hasBothActions,
                azureContext,
                showModelPicker,
            );

            if (result) {
                if (action === ContainerAssistAction.GenerateDeployment && result.deploymentFiles) {
                    generatedFiles.push(...result.deploymentFiles);
                } else if (action === ContainerAssistAction.GenerateWorkflow && result.workflowPath) {
                    workflowPath = result.workflowPath;
                }
            }
        }

        // Show post-generation options once when both actions completed
        if (hasBothActions) {
            const allFiles = [...generatedFiles];
            if (workflowPath) {
                allFiles.push(workflowPath);
            }
            await showPostGenerationOptions(allFiles, workspaceFolder, path.basename(projectRoot), true);
        }
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

interface ActionResult {
    deploymentFiles?: string[];
    workflowPath?: string;
}

async function processContainerAssistAction(
    action: ContainerAssistAction,
    service: ContainerAssistService,
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
    hasBothActions: boolean,
    azureContext: AzureContext,
    showModelPicker: boolean | undefined,
): Promise<ActionResult | undefined> {
    switch (action) {
        case ContainerAssistAction.GenerateDeployment:
            return await generateDeploymentFiles(
                service,
                workspaceFolder,
                targetPath,
                hasBothActions,
                azureContext,
                showModelPicker,
            );

        case ContainerAssistAction.GenerateWorkflow:
            return await generateWorkflowFile(workspaceFolder, targetPath, hasBothActions, azureContext);

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
    showModelPicker: boolean | undefined,
): Promise<ActionResult | undefined> {
    const appName = path.basename(targetPath);
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
                progress.report({ message: l10n.t("Analyzing project {0}...", appName) });

                const generationResult = await service.generateDeploymentFiles(
                    targetPath,
                    appName,
                    acrLoginServer,
                    abortController.signal,
                    token,
                    showModelPicker ?? false,
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
        logger.warn("No files were generated");
        vscode.window.showWarningMessage(l10n.t("No deployment files were generated."));
        return undefined;
    }

    // Defer post-generation options when both actions are selected
    if (hasBothActions) {
        return { deploymentFiles: generatedFiles };
    }

    // Show options only for deployment files
    await showPostGenerationOptions(generatedFiles, _workspaceFolder, appName, false);
    return { deploymentFiles: generatedFiles };
}

async function generateWorkflowFile(
    workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
    hasBothActions: boolean,
    azureContext: AzureContext,
): Promise<ActionResult | undefined> {
    // Show progress notification when both actions are selected
    const result = hasBothActions
        ? await vscode.window.withProgress(
              {
                  location: vscode.ProgressLocation.Notification,
                  title: l10n.t("Generating GitHub workflow file..."),
                  cancellable: false,
              },
              async () => {
                  return await generateGitHubWorkflow(workspaceFolder, targetPath, azureContext, hasBothActions);
              },
          )
        : await generateGitHubWorkflow(workspaceFolder, targetPath, azureContext, hasBothActions);

    if (failed(result)) {
        logger.error("GitHub workflow generation failed", result.error);
        vscode.window.showErrorMessage(l10n.t("Failed to generate GitHub workflow: {0}", result.error));
        return undefined;
    }

    const workflowPath = result.result;

    // Defer post-generation options when both actions are selected
    if (hasBothActions) {
        return { workflowPath };
    }

    await showPostGenerationOptions([workflowPath], workspaceFolder, path.basename(targetPath), true);

    return { workflowPath };
}

async function showPostGenerationOptions(
    generatedFiles: string[],
    workspaceFolder: vscode.WorkspaceFolder,
    appName: string,
    includeOIDC: boolean,
): Promise<void> {
    const openFiles = l10n.t("Open Files");
    const addToGit = l10n.t("Add to Git & Create PR");

    // Check if workflow files were generated
    const hasWorkflowFile = generatedFiles.some((file) => file.includes(".github/workflows/"));

    let message: string;
    const options = [openFiles, addToGit];

    // Only show OIDC option if workflow was generated
    if (includeOIDC && hasWorkflowFile) {
        message = l10n.t(
            "Generated {0} files including GitHub workflow! Do you wish to setup OIDC for GitHub Actions?",
            generatedFiles.length,
        );
        const setupOIDC = l10n.t("🔐 Setup OIDC Authentication");
        const setSecrets = l10n.t("🔑 Set GitHub Actions Secrets");
        const learnMore = l10n.t("📖 Learn More About OIDC");

        // Insert OIDC options at the beginning for prominence
        options.unshift(setupOIDC);
        options.push(setSecrets);
        options.push(learnMore);

        const selection = await vscode.window.showInformationMessage(
            message,
            {
                modal: true, // Make it modal to ensure users see the OIDC requirement
                detail: l10n.t(
                    "Your GitHub workflow needs OIDC authentication to deploy to Azure. Without it, the workflow will fail when trying to authenticate with Azure.",
                ),
            },
            ...options,
        );

        if (selection === setupOIDC) {
            await setupOIDCForGitHub(workspaceFolder, appName);
        } else if (selection === setSecrets) {
            await vscode.commands.executeCommand("aks.setGitHubActionsSecrets");
        } else if (selection === learnMore) {
            vscode.env.openExternal(
                vscode.Uri.parse(
                    "https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-azure",
                ),
            );
        } else if (selection === openFiles) {
            await openGeneratedFiles(generatedFiles);
        } else if (selection === addToGit) {
            await handleGitHubIntegration(generatedFiles, workspaceFolder, appName);
        }
    } else if (includeOIDC) {
        // Workflow generated but not detected in file list
        message = l10n.t("Successfully generated {0} files", generatedFiles.length);
        const setupOIDC = l10n.t("Setup OIDC for GitHub");
        options.push(setupOIDC);

        const selection = await vscode.window.showInformationMessage(message, ...options);
        if (selection === openFiles) {
            await openGeneratedFiles(generatedFiles);
        } else if (selection === addToGit) {
            await handleGitHubIntegration(generatedFiles, workspaceFolder, appName);
        } else if (selection === setupOIDC) {
            await setupOIDCForGitHub(workspaceFolder, appName);
        }
    } else {
        message = l10n.t("Successfully generated {0} deployment files", generatedFiles.length);
        const selection = await vscode.window.showInformationMessage(message, ...options);
        if (selection === openFiles) {
            await openGeneratedFiles(generatedFiles);
        } else if (selection === addToGit) {
            await handleGitHubIntegration(generatedFiles, workspaceFolder, appName);
        }
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

async function handleGitHubIntegration(
    generatedFiles: string[],
    workspaceFolder: vscode.WorkspaceFolder,
    appName: string,
): Promise<void> {
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
