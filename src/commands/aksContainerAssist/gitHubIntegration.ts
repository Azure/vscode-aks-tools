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
    inputBox: { value: string };
    add(paths: string[]): Promise<void>;
    commit(message: string): Promise<void>;
    createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
    state: RepositoryState;
    onDidCommit: vscode.Event<void>;
}

interface RepositoryState {
    HEAD: { name?: string; upstream?: { name: string; remote: string } } | undefined;
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
 * Acquires the Git extension API (v1), activating it if needed.
 */
async function getGitAPI(): Promise<GitAPI | undefined> {
    const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>("vscode.git");
    if (!gitExtension) {
        logger.warn("Git extension is not installed");
        return undefined;
    }

    if (!gitExtension.isActive) {
        logger.debug("Activating Git extension");
        await gitExtension.activate();
    }

    return gitExtension.exports.getAPI(1);
}

/**
 * Resolves the Git repository for a given workspace URI.
 * Shows user-facing warnings when the extension or repository is not found.
 */
export async function getGitRepository(workspaceUri: vscode.Uri): Promise<Repository | undefined> {
    const git = await getGitAPI();
    if (!git) {
        vscode.window.showWarningMessage(
            l10n.t("Git extension is not available. Please install or enable the Git extension."),
        );
        return undefined;
    }

    const repository = git.getRepository(workspaceUri);
    if (!repository) {
        vscode.window.showWarningMessage(
            l10n.t("No Git repository found. Please initialize Git in your workspace first."),
        );
        return undefined;
    }

    logger.debug("Git repository found", repository.rootUri.fsPath);
    return repository;
}

/**
 * Stages the given files in the Git index.
 * Uses the Git extension API, with a fallback to the `git` CLI.
 */
export async function stageFiles(repository: Repository, generatedFiles: string[]): Promise<boolean> {
    try {
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Container Assist"),
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: l10n.t("Staging generated files...") });

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
                    vscode.window.showWarningMessage(l10n.t("No valid files to stage."));
                    return false;
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
                        vscode.window.showErrorMessage(
                            l10n.t(
                                "Failed to stage files: {0}",
                                cmdError instanceof Error ? cmdError.message : String(cmdError),
                            ),
                        );
                        return false;
                    }
                }

                progress.report({ message: l10n.t("Files staged successfully") });
                return true;
            },
        );
    } catch (error) {
        logger.error("Error during file staging", error);
        vscode.window.showErrorMessage(
            l10n.t("Failed to stage files: {0}", error instanceof Error ? error.message : String(error)),
        );
        return false;
    }
}

/**
 * Offers to create a feature branch if the user is on a primary branch (main/master).
 * Uses a non-modal notification so it doesn't steal focus or dismiss on outside clicks.
 * Returns true if a branch was created (or the user chose to stay), false if cancelled.
 */
export async function offerFeatureBranch(repository: Repository, appName: string): Promise<boolean> {
    const currentBranch = repository.state.HEAD?.name;
    if (!currentBranch || (currentBranch !== "main" && currentBranch !== "master")) {
        // Already on a non-primary branch, nothing to do
        return true;
    }

    const safeName = appName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const suggestedBranch = `feat/aks-deploy-${safeName}`;

    const createBranch = l10n.t("Create Branch");
    const stay = l10n.t("Stay on {0}", currentBranch);

    const selection = await vscode.window.showInformationMessage(
        l10n.t(
            'You are on "{0}". It is recommended to create a feature branch ("{1}") for these changes.',
            currentBranch,
            suggestedBranch,
        ),
        createBranch,
        stay,
    );

    if (!selection) {
        // Dismissed — treat as "stay" so the flow continues rather than cancelling
        return true;
    }

    if (selection === createBranch) {
        try {
            await repository.createBranch(suggestedBranch, true);
            logger.info(`Created and checked out branch: ${suggestedBranch}`);
        } catch (error) {
            logger.error("Failed to create branch", error);
            vscode.window.showErrorMessage(
                l10n.t("Failed to create branch: {0}", error instanceof Error ? error.message : String(error)),
            );
            return false;
        }
    }

    return true;
}

/**
 * Generates a conventional commit message for the generated files.
 */
export function generateCommitMessage(generatedFiles: string[], appName: string): string {
    const fileNames = generatedFiles.map((f) => path.basename(f));
    const hasDockerfile = fileNames.some((f) => f === "Dockerfile");
    const hasWorkflow = generatedFiles.some((f) => f.includes(".github/workflows/"));
    const hasK8s = generatedFiles.some(
        (f) => !f.includes(".github/workflows/") && (f.endsWith(".yaml") || f.endsWith(".yml")),
    );

    // Build a concise description from what's actually staged
    const parts: string[] = [];
    if (hasDockerfile) parts.push("Dockerfile");
    if (hasK8s) parts.push("k8s manifests");
    if (hasWorkflow) parts.push("CI workflow");

    // Determine scope from staged file types
    let scope: string;
    if (hasWorkflow && !hasDockerfile && !hasK8s) {
        scope = "ci";
    } else {
        scope = "deploy";
    }

    const description = parts.length > 0 ? parts.join(", ") : fileNames.join(", ");

    return `feat(${scope}): add ${description} for ${appName}`;
}

/**
 * Pre-fills the SCM commit message box and focuses the Source Control view,
 * so the user can review diffs and commit at their own pace.
 */
export async function prepareCommitInSCM(
    repository: Repository,
    generatedFiles: string[],
    appName: string,
): Promise<void> {
    // Only pre-fill if the input box is currently empty to avoid overwriting user's message
    if (!repository.inputBox.value) {
        repository.inputBox.value = generateCommitMessage(generatedFiles, appName);
    }

    // Focus the Source Control view so the user sees staged changes
    await vscode.commands.executeCommand("workbench.view.scm");
}

/**
 * Creates a pull request via the GitHub Pull Requests extension.
 */
export async function createPullRequest(generatedFiles: string[], appName: string): Promise<void> {
    try {
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
        } catch (error) {
            // Fallback: try alternative command
            logger.debug("First PR command failed, trying alternative", error);
            await vscode.commands.executeCommand("github.createPullRequest");

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
