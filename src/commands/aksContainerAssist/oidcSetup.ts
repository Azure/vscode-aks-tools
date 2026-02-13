import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { ManagedServiceIdentityClient } from "@azure/arm-msi";
import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ResourceManagementClient } from "@azure/arm-resources";
import { getSessionProvider } from "../../auth/azureSessionProvider";
import { isReady } from "../../auth/types";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getCredential } from "../../auth/azureAuth";
import { succeeded } from "../utils/errorable";
import { logger } from "./logger";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import type { TokenCredential } from "@azure/identity";

const execFilePromise = promisify(execFile);

interface OIDCSetupResult {
    clientId: string;
    tenantId: string;
    subscriptionId: string;
    identityName: string;
    resourceGroup: string;
}

/**
 * Sets up OIDC federated identity for GitHub Actions workflow
 */
export async function setupOIDCForGitHub(workspaceFolder: vscode.WorkspaceFolder, appName: string): Promise<void> {
    try {
        logger.info("Starting OIDC setup for GitHub Actions");

        // Get GitHub repository information
        const repoInfo = await getGitHubRepoInfo(workspaceFolder);
        if (!repoInfo) {
            vscode.window.showErrorMessage(
                l10n.t("Unable to determine GitHub repository. Please ensure this is a GitHub repository."),
            );
            return;
        }

        logger.debug("GitHub repository info", repoInfo);

        // Prompt user for Azure details
        const azureConfig = await promptForAzureConfig(appName);
        if (!azureConfig) {
            logger.info("OIDC setup cancelled by user");
            return;
        }

        // Create managed identity and set up OIDC
        const result = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Setting up OIDC for GitHub Actions"),
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: l10n.t("Authenticating with Azure...") });

                const sessionProvider = await getSessionProvider();
                if (!isReady(sessionProvider)) {
                    throw new Error("Not signed in to Azure. Please sign in first.");
                }

                const credential = getCredential(sessionProvider);

                progress.report({ message: l10n.t("Creating managed identity...") });

                const identityResult = await createManagedIdentity(
                    credential,
                    azureConfig.subscriptionId,
                    azureConfig.resourceGroup,
                    azureConfig.identityName,
                    azureConfig.location,
                );

                logger.info(`Managed identity created with clientId: ${identityResult.clientId}`);

                progress.report({ message: l10n.t("Assigning role permissions...") });

                await assignContributorRole(
                    credential,
                    azureConfig.subscriptionId,
                    azureConfig.resourceGroup,
                    identityResult.principalId,
                );

                logger.info("Role assigned successfully");

                progress.report({ message: l10n.t("Configuring federated credentials...") });

                await createFederatedCredential(
                    credential,
                    azureConfig.subscriptionId,
                    azureConfig.resourceGroup,
                    azureConfig.identityName,
                    repoInfo,
                );

                logger.info("Federated credential created successfully");

                return {
                    clientId: identityResult.clientId,
                    tenantId: identityResult.tenantId,
                    subscriptionId: azureConfig.subscriptionId,
                    identityName: azureConfig.identityName,
                    resourceGroup: azureConfig.resourceGroup,
                };
            },
        );

        // Display the results
        await displayOIDCResults(result);
    } catch (error) {
        logger.error("Error during OIDC setup", error);
        vscode.window.showErrorMessage(
            l10n.t("Failed to setup OIDC: {0}", error instanceof Error ? error.message : String(error)),
        );
    }
}

async function getGitHubRepoInfo(workspaceFolder: vscode.WorkspaceFolder): Promise<{
    owner: string;
    repo: string;
    branch: string;
} | null> {
    try {
        // Get remote URL
        const { stdout: remoteUrl } = await execFilePromise("git", ["config", "--get", "remote.origin.url"], {
            cwd: workspaceFolder.uri.fsPath,
        });

        // Parse GitHub URL (supports both HTTPS and SSH)
        const httpsMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
        if (!httpsMatch) {
            return null;
        }

        const owner = httpsMatch[1];
        const repo = httpsMatch[2].replace(".git", "").trim();

        // Get current branch
        const { stdout: branch } = await execFilePromise("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: workspaceFolder.uri.fsPath,
        });

        return {
            owner,
            repo,
            branch: branch.trim(),
        };
    } catch (error) {
        logger.error("Failed to get GitHub repo info", error);
        return null;
    }
}

async function promptForAzureConfig(appName: string): Promise<{
    subscriptionId: string;
    resourceGroup: string;
    identityName: string;
    location: string;
} | null> {
    // Get subscription
    const sessionProvider = await getSessionProvider();
    if (!isReady(sessionProvider)) {
        vscode.window.showErrorMessage(l10n.t("Not signed in to Azure. Please sign in first."));
        return null;
    }

    const subscriptionsResult = await getSubscriptions(sessionProvider, SelectionType.All);
    if (!succeeded(subscriptionsResult)) {
        vscode.window.showErrorMessage(l10n.t("Failed to get subscriptions: {0}", subscriptionsResult.error));
        return null;
    }

    const subscriptions = subscriptionsResult.result;

    if (subscriptions.length === 0) {
        const openPortal = l10n.t("Open in Portal");
        const selection = await vscode.window.showWarningMessage(
            l10n.t("No Azure subscriptions found."),
            openPortal,
        );

        if (selection === openPortal) {
            vscode.env.openExternal(
                vscode.Uri.parse("https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade"),
            );
        }
        return null;
    }

    const subItems = subscriptions.map((sub) => ({
        label: sub.displayName,
        description: sub.subscriptionId,
        subscriptionId: sub.subscriptionId,
    }));

    const selectedSub = await vscode.window.showQuickPick(subItems, {
        placeHolder: l10n.t("Select Azure subscription"),
        title: l10n.t("OIDC Setup - Subscription"),
    });

    if (!selectedSub) return null;

    // Get resource group
    const resourceGroup = await vscode.window.showInputBox({
        prompt: l10n.t("Enter resource group name (will be created if it doesn't exist)"),
        value: `rg-${appName}-oidc`,
        title: l10n.t("OIDC Setup - Resource Group"),
    });

    if (!resourceGroup) return null;

    // Get identity name
    const identityName = await vscode.window.showInputBox({
        prompt: l10n.t("Enter managed identity name"),
        value: `id-${appName}-github`,
        title: l10n.t("OIDC Setup - Identity Name"),
    });

    if (!identityName) return null;

    // Get location
    const location = await vscode.window.showInputBox({
        prompt: l10n.t("Enter Azure region"),
        value: "eastus",
        title: l10n.t("OIDC Setup - Location"),
    });

    if (!location) return null;

    return {
        subscriptionId: selectedSub.subscriptionId,
        resourceGroup,
        identityName,
        location,
    };
}

async function createManagedIdentity(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
    identityName: string,
    location: string,
): Promise<{ clientId: string; tenantId: string; principalId: string }> {
    const msiClient = new ManagedServiceIdentityClient(credential, subscriptionId);

    // Ensure resource group exists
    const resourceClient = new ResourceManagementClient(credential, subscriptionId);

    try {
        await resourceClient.resourceGroups.createOrUpdate(resourceGroup, {
            location,
        });
        logger.info(`Resource group ${resourceGroup} created or already exists`);
    } catch (error) {
        logger.warn(`Failed to create resource group: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Create managed identity
    const identity = await msiClient.userAssignedIdentities.createOrUpdate(resourceGroup, identityName, {
        location,
        tags: {
            purpose: "GitHub Actions OIDC",
            createdBy: "AKS VS Code Extension",
        },
    });

    if (!identity.clientId || !identity.tenantId || !identity.principalId) {
        throw new Error("Failed to create managed identity: missing required properties");
    }

    return {
        clientId: identity.clientId,
        tenantId: identity.tenantId,
        principalId: identity.principalId,
    };
}

async function assignContributorRole(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
    principalId: string,
): Promise<void> {
    const authClient = new AuthorizationManagementClient(credential, subscriptionId);

    const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
    const contributorRoleId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c`;

    // Generate a GUID for the role assignment
    const roleAssignmentName = randomUUID();

    try {
        await authClient.roleAssignments.create(scope, roleAssignmentName, {
            roleDefinitionId: contributorRoleId,
            principalId: principalId,
            principalType: "ServicePrincipal",
        });
        logger.info("Contributor role assigned successfully");
    } catch (error) {
        // If role already exists, that's fine
        if (error && typeof error === "object" && "code" in error && error.code !== "RoleAssignmentExists") {
            throw error;
        }
        logger.info("Role assignment already exists");
    }
}

async function createFederatedCredential(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
    identityName: string,
    repoInfo: { owner: string; repo: string; branch: string },
): Promise<void> {
    const msiClient = new ManagedServiceIdentityClient(credential, subscriptionId);

    const credentialName = "GitHubActions";
    const subject = `repo:${repoInfo.owner}/${repoInfo.repo}:ref:refs/heads/${repoInfo.branch}`;

    await msiClient.federatedIdentityCredentials.createOrUpdate(resourceGroup, identityName, credentialName, {
        issuer: "https://token.actions.githubusercontent.com",
        subject: subject,
        audiences: ["api://AzureADTokenExchange"],
    });

    logger.info(`Federated credential created with subject: ${subject}`);
}

async function displayOIDCResults(result: OIDCSetupResult): Promise<void> {
    const message = l10n.t("OIDC setup completed successfully! Add these secrets to your GitHub repository:");

    const copyAll = l10n.t("Copy All");
    const viewInstructions = l10n.t("View Instructions");

    const secretsText = `AZURE_CLIENT_ID: ${result.clientId}
AZURE_TENANT_ID: ${result.tenantId}
AZURE_SUBSCRIPTION_ID: ${result.subscriptionId}`;

    // Show in output channel with detailed info
    logger.info("=== OIDC Setup Complete ===");
    logger.info(`Identity Name: ${result.identityName}`);
    logger.info(`Resource Group: ${result.resourceGroup}`);
    logger.info(`\nGitHub Secrets (add these to your repository):`);
    logger.info(`AZURE_CLIENT_ID: ${result.clientId}`);
    logger.info(`AZURE_TENANT_ID: ${result.tenantId}`);
    logger.info(`AZURE_SUBSCRIPTION_ID: ${result.subscriptionId}`);
    logger.info(`\nWorkflow snippet:`);
    logger.info(`permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}`);
    logger.info("===========================");

    const selection = await vscode.window.showInformationMessage(message, copyAll, viewInstructions);

    if (selection === copyAll) {
        await vscode.env.clipboard.writeText(secretsText);
        vscode.window.showInformationMessage(l10n.t("Secrets copied to clipboard!"));
    } else if (selection === viewInstructions) {
        logger.show();
    }
}
