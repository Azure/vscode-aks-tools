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

interface AzureConfig {
    subscriptionId: string;
    resourceGroup: string;
    identityName: string;
    location: string;
    isExistingIdentity: boolean;
}

/**
 * Sets up OIDC federated identity for GitHub Actions workflow
 */
export async function setupOIDCForGitHub(workspaceFolder: vscode.WorkspaceFolder, appName: string): Promise<void> {
    try {
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

                if (azureConfig.isExistingIdentity) {
                    progress.report({ message: l10n.t("Retrieving managed identity...") });
                } else {
                    progress.report({ message: l10n.t("Creating managed identity...") });
                }

                const identityResult = await getManagedIdentity(
                    credential,
                    azureConfig.subscriptionId,
                    azureConfig.resourceGroup,
                    azureConfig.identityName,
                    azureConfig.location,
                    azureConfig.isExistingIdentity,
                );

                progress.report({ message: l10n.t("Assigning role permissions...") });

                await assignContributorRole(
                    credential,
                    azureConfig.subscriptionId,
                    azureConfig.resourceGroup,
                    identityResult.principalId,
                );

                progress.report({ message: l10n.t("Configuring federated credentials...") });

                await createFederatedCredential(
                    credential,
                    azureConfig.subscriptionId,
                    azureConfig.resourceGroup,
                    azureConfig.identityName,
                    repoInfo,
                );

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
    mainBranch?: string;
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

        // Try to get main/default branch
        let mainBranch: string | undefined = undefined;
        try {
            // Try to get symbolic-ref for origin/HEAD (default branch)
            const { stdout: headRef } = await execFilePromise("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
                cwd: workspaceFolder.uri.fsPath,
            });
            // refs/remotes/origin/main or refs/remotes/origin/master
            mainBranch = headRef.trim().split("/").pop();
        } catch {
            // fallback: try to get 'main' or 'master' if exists
            try {
                const { stdout: branches } = await execFilePromise("git", ["branch", "-r"], {
                    cwd: workspaceFolder.uri.fsPath,
                });
                if (branches.includes("origin/main")) {
                    mainBranch = "main";
                } else if (branches.includes("origin/master")) {
                    mainBranch = "master";
                }
            } catch {
                // Fallback will be used if branch detection fails
            }
        }

        return {
            owner,
            repo,
            branch: branch.trim(),
            mainBranch,
        };
    } catch (error) {
        logger.error("Failed to get GitHub repo info", error);
        return null;
    }
}

async function promptForAzureConfig(appName: string): Promise<AzureConfig | null> {
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
        const selection = await vscode.window.showWarningMessage(l10n.t("No Azure subscriptions found."), openPortal);

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

    // Get credential for listing identities
    const credential = getCredential(sessionProvider);

    // List existing managed identities in the resource group
    const existingIdentities = await listManagedIdentities(credential, selectedSub.subscriptionId, resourceGroup);

    // Decide whether to use existing or create new
    let useExistingIdentity = false;
    let selectedIdentityName: string | null = null;
    let location: string | undefined = undefined;

    if (existingIdentities.length > 0) {
        const identityChoice = await vscode.window.showQuickPick(
            [
                { label: l10n.t("Create new managed identity"), description: "", value: "new" },
                { label: l10n.t("Use existing managed identity"), description: "", value: "existing" },
            ],
            {
                placeHolder: l10n.t("Choose managed identity option"),
                title: l10n.t("OIDC Setup - Managed Identity"),
            },
        );

        if (!identityChoice) return null;

        if (identityChoice.value === "existing") {
            useExistingIdentity = true;

            const identityItems = existingIdentities.map((identity) => ({
                label: identity.name,
                description: identity.clientId,
            }));

            const selectedIdentity = await vscode.window.showQuickPick(identityItems, {
                placeHolder: l10n.t("Select managed identity"),
                title: l10n.t("OIDC Setup - Select Identity"),
            });

            if (!selectedIdentity) return null;

            selectedIdentityName = selectedIdentity.label;
        }
    }

    // Get identity name if creating new
    let identityName: string;
    if (useExistingIdentity && selectedIdentityName) {
        identityName = selectedIdentityName;
        location = "eastus"; // Dummy value, not used for existing identities
    } else {
        const newIdentityName = await vscode.window.showInputBox({
            prompt: l10n.t("Enter managed identity name"),
            value: `id-${appName}-github`,
            title: l10n.t("OIDC Setup - Identity Name"),
        });

        if (!newIdentityName) return null;

        identityName = newIdentityName;

        // Get location only if creating new
        const newLocation = await vscode.window.showInputBox({
            prompt: l10n.t("Enter Azure region"),
            value: "eastus",
            title: l10n.t("OIDC Setup - Location"),
        });

        if (!newLocation) return null;
        location = newLocation;
    }

    return {
        subscriptionId: selectedSub.subscriptionId,
        resourceGroup,
        identityName,
        location,
        isExistingIdentity: useExistingIdentity,
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

async function listManagedIdentities(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
): Promise<Array<{ name: string; clientId: string; principalId: string }>> {
    try {
        const msiClient = new ManagedServiceIdentityClient(credential, subscriptionId);
        const identities = await msiClient.userAssignedIdentities.listByResourceGroup(resourceGroup);

        const result: Array<{ name: string; clientId: string; principalId: string }> = [];
        for await (const identity of identities) {
            if (identity.name && identity.clientId && identity.principalId) {
                result.push({
                    name: identity.name,
                    clientId: identity.clientId,
                    principalId: identity.principalId,
                });
            }
        }

        return result;
    } catch (error) {
        // If the resource group doesn't exist yet, return empty array
        logger.debug("No existing managed identities found:", error);
        return [];
    }
}

async function getManagedIdentity(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
    identityName: string,
    location: string,
    isExisting: boolean,
): Promise<{ clientId: string; tenantId: string; principalId: string }> {
    const msiClient = new ManagedServiceIdentityClient(credential, subscriptionId);

    if (isExisting) {
        // Retrieve existing managed identity
        const identity = await msiClient.userAssignedIdentities.get(resourceGroup, identityName);

        if (!identity.clientId || !identity.tenantId || !identity.principalId) {
            throw new Error("Failed to retrieve managed identity: missing required properties");
        }

        logger.info(`Using existing managed identity: ${identityName}`);

        return {
            clientId: identity.clientId,
            tenantId: identity.tenantId,
            principalId: identity.principalId,
        };
    } else {
        // Create new managed identity
        return await createManagedIdentity(credential, subscriptionId, resourceGroup, identityName, location);
    }
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
    } catch (error) {
        // If role already exists, that's fine
        if (error && typeof error === "object" && "code" in error && error.code !== "RoleAssignmentExists") {
            throw error;
        }
    }
}

async function createFederatedCredential(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
    identityName: string,
    repoInfo: { owner: string; repo: string; branch: string; mainBranch?: string },
): Promise<void> {
    const msiClient = new ManagedServiceIdentityClient(credential, subscriptionId);

    const credentialName = "GitHubActions";
    // Always use 'main' as the branch for federated credential, matching workflow default
    const branch = repoInfo.mainBranch || "main";
    const subject = `repo:${repoInfo.owner}/${repoInfo.repo}:ref:refs/heads/${branch}`;

    await msiClient.federatedIdentityCredentials.createOrUpdate(resourceGroup, identityName, credentialName, {
        issuer: "https://token.actions.githubusercontent.com",
        subject: subject,
        audiences: ["api://AzureADTokenExchange"],
    });
}

async function displayOIDCResults(result: OIDCSetupResult): Promise<void> {
    // Show success information to user
    const message = l10n.t("OIDC setup completed successfully! Your federated identity is ready for GitHub Actions.");
    const copyAll = l10n.t("Copy GitHub Secrets");
    const viewInstructions = l10n.t("View Output");

    const secretsText = `AZURE_CLIENT_ID: ${result.clientId}
AZURE_TENANT_ID: ${result.tenantId}
AZURE_SUBSCRIPTION_ID: ${result.subscriptionId}`;

    // Show in output channel with detailed info

    const selection = await vscode.window.showInformationMessage(message, copyAll, viewInstructions);

    if (selection === copyAll) {
        await vscode.env.clipboard.writeText(secretsText);
        vscode.window.showInformationMessage(l10n.t("Secrets copied to clipboard!"));
    } else if (selection === viewInstructions) {
        logger.show();
    }
}
