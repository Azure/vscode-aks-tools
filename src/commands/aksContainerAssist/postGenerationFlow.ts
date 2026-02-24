import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { logger } from "./logger";
import {
    getGitRepository,
    stageFiles,
    offerFeatureBranch,
    prepareCommitInSCM,
    createPullRequest,
    isGitExtensionAvailable,
    isGitHubExtensionAvailable,
} from "./gitHubIntegration";
import { setupOIDCForGitHub } from "./oidcSetup";

// ─── Post-Generation Flow ─────────────────────────────────────────────────────
//
// After files are generated the flow is:
//   1. (If workflow) OIDC notification – "Setup OIDC" / "Skip"
//   2. Stage notification – "Stage & Review" / "Open Files"
//        • offers a feature branch when on main/master (non-modal notification)
//        • stages files, pre-fills commit message, focuses SCM view
//   3. onDidCommit listener – when the user commits, a notification offers
//      "Create Pull Request"
//
// Every prompt uses showInformationMessage / showWarningMessage (non-modal,
// sits in the notification area, doesn't steal focus or dismiss on outside
// clicks).
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Entry point for the post-generation UX.
 */
export async function showPostGenerationOptions(
    generatedFiles: string[],
    workspaceFolder: vscode.WorkspaceFolder,
    appName: string,
    includeOIDC: boolean,
): Promise<void> {
    const hasWorkflowFile = generatedFiles.some((file) => file.includes(".github/workflows/"));
    const showOIDC = includeOIDC && hasWorkflowFile;

    // Step 1 — OIDC (only when a workflow was generated)
    if (showOIDC) {
        await promptOIDCSetup(workspaceFolder, appName);
    }

    // Step 2 — Stage & review
    await promptStageAndReview(generatedFiles, workspaceFolder, appName);
}

// ─── Step 1: OIDC ──────────────────────────────────────────────────────────────

/**
 * Prompt the user to configure OIDC authentication.
 * The workflow won't deploy without it, so we surface this first.
 */
async function promptOIDCSetup(workspaceFolder: vscode.WorkspaceFolder, appName: string): Promise<void> {
    const setup = l10n.t("Setup OIDC");
    const skip = l10n.t("Skip");

    const selection = await vscode.window.showWarningMessage(
        l10n.t(
            "Your GitHub workflow requires OIDC authentication to deploy to Azure. Without it the workflow will fail.",
        ),
        setup,
        skip,
    );

    if (selection === setup) {
        await setupOIDCForGitHub(workspaceFolder, appName);
    }
    // "Skip" or dismissed — continue to the staging step either way.
}

// ─── Step 2: Stage & Review ────────────────────────────────────────────────────

/**
 * Offer to stage files and open the SCM view.
 * After staging succeeds, registers an onDidCommit listener for step 3.
 */
async function promptStageAndReview(
    generatedFiles: string[],
    workspaceFolder: vscode.WorkspaceFolder,
    appName: string,
): Promise<void> {
    const stageReview = l10n.t("Stage & Review");
    const openFiles = l10n.t("Open Files");

    const selection = await vscode.window.showInformationMessage(
        l10n.t("{0} files generated. Stage them and open Source Control to review?", generatedFiles.length),
        stageReview,
        openFiles,
    );

    if (selection === openFiles) {
        await openGeneratedFiles(generatedFiles);

        // After opening, give a second chance to stage
        const next = await vscode.window.showInformationMessage(
            l10n.t("Files opened. When you're ready, stage and review the changes."),
            l10n.t("Stage & Review"),
        );
        if (!next) {
            return; // dismissed
        }
    } else if (!selection) {
        return; // dismissed
    }

    // Perform the staging workflow
    const staged = await stageAndPrepare(generatedFiles, workspaceFolder, appName);
    if (!staged) {
        return;
    }

    // Show a confirmation notification
    vscode.window.showInformationMessage(
        l10n.t(
            "Files staged with a suggested commit message. Review the diffs in Source Control and commit when ready.",
        ),
    );

    // Step 3 — Listen for the user's commit, then offer PR creation
    await listenForCommitAndOfferPR(workspaceFolder, generatedFiles, appName);
}

/**
 * Validates git, offers feature branch, stages files, pre-fills commit message
 * and focuses the SCM view.
 * Returns true when staging succeeded.
 */
async function stageAndPrepare(
    generatedFiles: string[],
    workspaceFolder: vscode.WorkspaceFolder,
    appName: string,
): Promise<boolean> {
    const hasGit = await isGitExtensionAvailable();
    if (!hasGit) {
        vscode.window.showWarningMessage(
            l10n.t("Git extension is required for this feature. Please install or enable the Git extension."),
        );
        return false;
    }

    const repository = await getGitRepository(workspaceFolder.uri);
    if (!repository) {
        return false;
    }

    // Offer a feature branch when on main/master
    const branchOk = await offerFeatureBranch(repository, appName);
    if (!branchOk) {
        return false;
    }

    // Stage files
    const staged = await stageFiles(repository, generatedFiles);
    if (!staged) {
        return false;
    }

    // Pre-fill commit message and open SCM view
    await prepareCommitInSCM(repository, generatedFiles, appName);

    return true;
}

// ─── Step 3: Listen for Commit → Offer PR ──────────────────────────────────────

/**
 * Register an `onDidCommit` listener on the repository.
 * When the user commits (from the SCM view, terminal, etc.) we show a
 * non-modal notification offering to create a pull request.
 * The listener fires once and is then disposed.
 */
async function listenForCommitAndOfferPR(
    workspaceFolder: vscode.WorkspaceFolder,
    generatedFiles: string[],
    appName: string,
): Promise<void> {
    const repository = await getGitRepository(workspaceFolder.uri);
    if (!repository) {
        return;
    }

    // Wrap the event listener in a promise so the flow can await it,
    // but the user is free to interact with VS Code in the meantime.
    await new Promise<void>((resolve) => {
        const disposable = repository.onDidCommit(() => {
            disposable.dispose();

            const createPR = l10n.t("Create Pull Request");
            const dismiss = l10n.t("Dismiss");

            vscode.window
                .showInformationMessage(
                    l10n.t("Changes committed. Would you like to create a pull request?"),
                    createPR,
                    dismiss,
                )
                .then(async (prSelection) => {
                    if (prSelection === createPR) {
                        await handleCreatePR(generatedFiles, appName);
                    }
                    resolve();
                });
        });
    });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Validates that the GitHub extension is available, then delegates to createPullRequest.
 */
async function handleCreatePR(generatedFiles: string[], appName: string): Promise<void> {
    logger.info("Starting pull request creation");

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

    const hasGitHub = await isGitHubExtensionAvailable();
    if (!hasGitHub) {
        const install = l10n.t("Install Extension");
        const selection = await vscode.window.showWarningMessage(
            l10n.t("GitHub Pull Requests extension is recommended for creating PRs. Would you like to install it?"),
            install,
        );
        if (selection === install) {
            await vscode.commands.executeCommand("workbench.extensions.search", "GitHub.vscode-pull-request-github");
        }
        return;
    }

    await createPullRequest(generatedFiles, appName);
}
