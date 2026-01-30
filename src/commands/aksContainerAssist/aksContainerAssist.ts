import * as vscode from "vscode";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ContainerAssistService } from "./containerAssistService";
import { ContainerAssistAction, ContainerAssistQuickPickItem } from "./types";
import { failed } from "../utils/errorable";
import * as l10n from "@vscode/l10n";
import * as path from "path";

/**
 * Main command handler for Container Assist feature
 * Displays a QuickPick with checklist options for deployment generation
 */
export async function runContainerAssist(_context: IActionContext, target: unknown): Promise<void> {
    // Get the target folder from the context
    const targetUri = getTargetUri(target);
    if (!targetUri) {
        vscode.window.showErrorMessage(
            l10n.t("Please right-click on a folder in the explorer to use Container Assist."),
        );
        return;
    }

    // Get the workspace folder
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
    if (!workspaceFolder) {
        vscode.window.showErrorMessage(l10n.t("The selected folder is not part of a workspace."));
        return;
    }

    // Check if Container Assist is available
    const containerAssistService = new ContainerAssistService();
    const availabilityCheck = await containerAssistService.isAvailable();
    if (failed(availabilityCheck)) {
        vscode.window.showErrorMessage(availabilityCheck.error);
        return;
    }

    // Show QuickPick with checklist options
    const selectedActions = await showContainerAssistQuickPick();
    if (!selectedActions || selectedActions.length === 0) {
        // User cancelled or didn't select anything
        return;
    }

    // Process selected actions
    for (const action of selectedActions) {
        await processContainerAssistAction(action, containerAssistService, workspaceFolder, targetUri.fsPath);
    }
}

/**
 * Extract the URI from the command target
 */
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

/**
 * Show QuickPick with checklist for Container Assist actions
 */
async function showContainerAssistQuickPick(): Promise<ContainerAssistAction[] | undefined> {
    const items: ContainerAssistQuickPickItem[] = [
        {
            label: l10n.t("$(file) Generate Deployment Files"),
            description: l10n.t("Analyze → Generate Dockerfile → Generate Kubernetes Manifests"),
            action: ContainerAssistAction.GenerateDeployment,
            picked: false,
        },
        {
            label: l10n.t("$(github-action) Generate Default Workflow"),
            description: l10n.t("Create GitHub Actions workflow (Coming soon)"),
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

/**
 * Process a single Container Assist action
 */
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
            await generateDefaultWorkflow(workspaceFolder, targetPath);
            break;

        default:
            vscode.window.showWarningMessage(l10n.t("Unknown action: {0}", action));
    }
}

/**
 * Generate deployment files using Container Assist
 * Orchestrates: Analyze → Dockerfile → K8s Manifests
 */
async function generateDeploymentFiles(
    service: ContainerAssistService,
    _workspaceFolder: vscode.WorkspaceFolder,
    targetPath: string,
): Promise<void> {
    try {
        // Get app name from folder name
        const appName = path.basename(targetPath);

        // Show progress notification
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Container Assist"),
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: l10n.t("Generating deployment files for {0}...", appName) });

                const result = await service.generateDeploymentFiles(targetPath, appName);

                if (!result.succeeded) {
                    vscode.window.showErrorMessage(
                        l10n.t("Failed to generate deployment files: {0}", result.error || "Unknown error"),
                    );
                    return;
                }

                if (result.generatedFiles && result.generatedFiles.length > 0) {
                    const message = l10n.t("Successfully generated {0} deployment files", result.generatedFiles.length);
                    const openFiles = l10n.t("Open Files");

                    vscode.window.showInformationMessage(message, openFiles).then((selection) => {
                        if (selection === openFiles) {
                            // Open the generated files
                            result.generatedFiles?.forEach((file: string) => {
                                vscode.workspace.openTextDocument(file).then((doc) => {
                                    vscode.window.showTextDocument(doc);
                                });
                            });
                        }
                    });
                }
            },
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            l10n.t("An error occurred while generating deployment files: {0}", String(error)),
        );
    }
}

/**
 * Generate default workflow (placeholder for future implementation)
 */
async function generateDefaultWorkflow(_workspaceFolder: vscode.WorkspaceFolder, _targetPath: string): Promise<void> {
    console.log("Generate Default Workflow feature is not yet implemented.");
    console.log(`${_workspaceFolder}, ${_targetPath}`);
    vscode.window.showInformationMessage(
        l10n.t(
            "Generate Default Workflow feature is coming soon. This will create a GitHub Actions workflow for CI/CD.",
        ),
    );

    // TODO: Implement workflow generation in future iteration
    // This would likely:
    // 1. Create .github/workflows directory if it doesn't exist
    // 2. Generate a workflow YAML file with build, push, and deploy steps
    // 3. Configure it to work with the generated Dockerfile and manifests
}
