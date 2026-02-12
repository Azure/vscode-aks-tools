import * as vscode from "vscode";
import * as path from "path";
import { logger } from "./logger";
import * as l10n from "@vscode/l10n";
import { promisify } from "util";
import { execFile } from "child_process";

const execFilePromise = promisify(execFile);

interface GitAPI {
    repositories: Repository[];
    getRepository(uri: vscode.Uri): Repository | null;
}

interface Repository {
    rootUri: vscode.Uri;
    add(paths: string[]): Promise<void>;
    commit(message: string): Promise<void>;
    state: RepositoryState;
}

interface RepositoryState {
    workingTreeChanges: Change[];
    indexChanges: Change[];
}

interface Change {
    uri: vscode.Uri;
    status: number;
}

interface GitHubPROptions {
    title?: string;
    body?: string;
    draft?: boolean;
    base?: string;
}

/**
 * Stages generated files to Git and optionally creates a PR via GitHub extension
 */
export async function stageFilesAndCreatePR(
    generatedFiles: string[],
    workspaceUri: vscode.Uri,
    appName: string,
): Promise<void> {
    try {
        logger.info("Starting Git staging and PR creation workflow");
        logger.debug("Files to stage", generatedFiles);

        // Get Git extension
        const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>("vscode.git");
        if (!gitExtension) {
            const message = l10n.t("Git extension is not available. Please install or enable the Git extension.");
            vscode.window.showWarningMessage(message);
            logger.warn(message);
            return;
        }

        if (!gitExtension.isActive) {
            logger.debug("Activating Git extension");
            await gitExtension.activate();
        }

        const git = gitExtension.exports.getAPI(1);
        logger.debug("Git API version 1 acquired");

        const repository = git.getRepository(workspaceUri);

        if (!repository) {
            const message = l10n.t("No Git repository found. Please initialize Git in your workspace first.");
            vscode.window.showWarningMessage(message);
            logger.warn(message);
            return;
        }

        logger.debug("Git repository found", repository.rootUri.fsPath);

        // Stage generated files
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Container Assist - Git Integration"),
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: l10n.t("Staging generated files...") });

                logger.debug("Repository root", repository.rootUri.fsPath);

                // Verify files exist and convert to relative paths
                const filesToStage: string[] = [];
                for (const file of generatedFiles) {
                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(file));
                        const relativePath = path.relative(repository.rootUri.fsPath, file);
                        filesToStage.push(relativePath);
                        logger.debug(`File exists and will be staged: ${relativePath}`);
                    } catch (error) {
                        logger.warn(
                            `File does not exist, skipping: ${file} - ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                }

                if (filesToStage.length === 0) {
                    throw new Error("No valid files to stage");
                }

                // Try to stage files using Git API
                try {
                    await repository.add(filesToStage);
                    logger.info(`Successfully staged ${filesToStage.length} files via Git API`);
                } catch (gitError) {
                    logger.error("Git API add failed, attempting manual git command", gitError);

                    // Fallback: use git command directly
                    try {
                        const args = ["add", ...filesToStage];
                        logger.debug(`Running: git ${args.join(" ")}`);
                        await execFilePromise("git", args, { cwd: repository.rootUri.fsPath });
                        logger.info(`Successfully staged ${filesToStage.length} files via git command`);
                    } catch (cmdError) {
                        logger.error("Git command also failed", cmdError);
                        throw new Error(
                            `Failed to stage files: ${cmdError instanceof Error ? cmdError.message : String(cmdError)}`,
                        );
                    }
                }

                progress.report({ message: l10n.t("Files staged successfully") });
            },
        );

        // Ask user if they want to create a PR
        const config = vscode.workspace.getConfiguration("aks.containerAssist");
        const promptForPR = config.get<boolean>("promptForPullRequest", true);

        if (!promptForPR || (await shouldCreatePR())) {
            await createPullRequest(generatedFiles, appName);
        } else {
            vscode.window.showInformationMessage(
                l10n.t("Files have been staged. You can commit and create a PR manually."),
            );
        }
    } catch (error) {
        logger.error("Error during Git staging and PR creation", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error details", errorMessage);
        vscode.window.showErrorMessage(l10n.t("Failed to stage files or create PR: {0}", errorMessage));
    }
}

async function shouldCreatePR(): Promise<boolean> {
    const createPR = l10n.t("Create Pull Request");
    const stageOnly = l10n.t("Stage Only");

    const selection = await vscode.window.showInformationMessage(
        l10n.t("Files have been staged. Would you like to create a Pull Request?"),
        createPR,
        stageOnly,
    );

    return selection === createPR;
}

async function createPullRequest(generatedFiles: string[], appName: string): Promise<void> {
    try {
        logger.info("Attempting to create Pull Request via GitHub extension");

        // Check if GitHub Pull Requests extension is installed
        const githubExtension =
            vscode.extensions.getExtension("github.vscode-pull-request-github") ||
            vscode.extensions.getExtension("GitHub.vscode-pull-request-github");

        if (!githubExtension) {
            const message = l10n.t(
                "GitHub Pull Requests extension is not installed. Please install it to create PRs directly from VS Code.",
            );
            const install = l10n.t("Install Extension");

            const selection = await vscode.window.showWarningMessage(message, install);
            if (selection === install) {
                await vscode.commands.executeCommand(
                    "workbench.extensions.search",
                    "GitHub.vscode-pull-request-github",
                );
            }
            logger.warn(message);
            return;
        }

        // Activate extension if needed
        if (!githubExtension.isActive) {
            await githubExtension.activate();
            logger.debug("GitHub extension activated");
        }

        // Get configuration
        const config = vscode.workspace.getConfiguration("aks.containerAssist");
        const defaultBranch = config.get<string>("prDefaultBranch", "main");
        const createAsDraft = config.get<boolean>("prCreateAsDraft", true);

        // Generate PR title and body
        const prTitle = l10n.t("feat: Add container and K8s deployment files for {0}", appName);
        const prBody = generatePRBody(generatedFiles);

        const options: GitHubPROptions = {
            title: prTitle,
            body: prBody,
            draft: createAsDraft,
            base: defaultBranch,
        };

        logger.debug("Creating PR with options", options);

        // Try to invoke GitHub extension command
        // Note: The exact command signature may vary based on GitHub extension version
        try {
            await vscode.commands.executeCommand("pr.create", options);
            logger.info("Pull Request creation dialog opened");
        } catch (error) {
            // Fallback: try alternative command
            logger.debug("First PR command failed, trying alternative", error);
            await vscode.commands.executeCommand("github.createPullRequest");
            logger.info("GitHub PR creation panel opened (manual mode)");

            // Show helpful message with suggested PR details
            vscode.window.showInformationMessage(
                l10n.t(
                    "GitHub PR creation opened. Suggested title: {0}\n\nFiles:\n{1}",
                    prTitle,
                    generatedFiles.map((f) => `- ${path.basename(f)}`).join("\n"),
                ),
            );
        }
    } catch (error) {
        logger.error("Error creating Pull Request", error);
        vscode.window.showErrorMessage(
            l10n.t("Failed to create Pull Request: {0}", error instanceof Error ? error.message : String(error)),
        );
    }
}

function generatePRBody(generatedFiles: string[]): string {
    const fileList = generatedFiles.map((file) => `- \`${path.basename(file)}\``).join("\n");

    return `## Container Assist - Generated Deployment Files

This PR adds containerization and Kubernetes deployment files generated by the AKS Container Assist feature.

### Generated Files
${fileList}

### Description
These files enable containerized deployment of the application to Azure Kubernetes Service (AKS):
- **Dockerfile**: Optimized container image configuration
- **Kubernetes Manifests**: Deployment, Service, and related resources

### Next Steps
- Review the generated configuration
- Update environment-specific values (image registry, resource limits, etc.)
- Test the deployment in a dev/staging environment
- Merge when ready to enable AKS deployment

---
*Generated by AKS Container Assist*`;
}

/**
 * Check if GitHub extension commands are available
 */
export async function isGitHubExtensionAvailable(): Promise<boolean> {
    const githubExtension =
        vscode.extensions.getExtension("github.vscode-pull-request-github") ||
        vscode.extensions.getExtension("GitHub.vscode-pull-request-github");
    return githubExtension !== undefined;
}

/**
 * Check if Git extension is available
 */
export async function isGitExtensionAvailable(): Promise<boolean> {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    return gitExtension !== undefined;
}
