import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { ManagedServiceIdentityClient } from "@azure/arm-msi";
import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ResourceManagementClient } from "@azure/arm-resources";
import { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";
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

                await assignAksClusterUserRole(
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
        await displayOIDCResults(result, repoInfo);
    } catch (error) {
        logger.error("Error during OIDC setup", error);
        vscode.window.showErrorMessage(
            l10n.t("Failed to setup OIDC: {0}", error instanceof Error ? error.message : String(error)),
        );
    }
}

export async function getGitHubRepoInfo(workspaceFolder: vscode.WorkspaceFolder): Promise<{
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

        logger.debug(`Using existing managed identity: ${identityName}`);

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

async function assignAksClusterUserRole(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
    principalId: string,
): Promise<void> {
    const authClient = new AuthorizationManagementClient(credential, subscriptionId);
    // documentation official here https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
    const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
    // Azure Kubernetes Service Cluster User Role
    const aksClusterUserRoleId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/4abbcc35-e782-43d8-92c5-2d3f1bd2253f`;

    // Generate a GUID for the role assignment
    const roleAssignmentName = randomUUID();

    try {
        await authClient.roleAssignments.create(scope, roleAssignmentName, {
            roleDefinitionId: aksClusterUserRoleId,
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

async function displayOIDCResults(result: OIDCSetupResult, repoInfo: { owner: string; repo: string }): Promise<void> {
    // Show success information to user
    const message = l10n.t("OIDC setup completed successfully! Your federated identity is ready for GitHub Actions.");
    const copyAll = l10n.t("Copy GitHub Secrets");
    const setSecrets = l10n.t("Set GitHub Secrets");
    const viewInstructions = l10n.t("View Output");

    const secretsText = `AZURE_CLIENT_ID: ${result.clientId}
AZURE_TENANT_ID: ${result.tenantId}
AZURE_SUBSCRIPTION_ID: ${result.subscriptionId}`;

    // Show in output channel with detailed info

    const selection = await vscode.window.showInformationMessage(message, copyAll, setSecrets, viewInstructions);

    if (selection === copyAll) {
        await vscode.env.clipboard.writeText(secretsText);
        vscode.window.showInformationMessage(l10n.t("Secrets copied to clipboard!"));
    } else if (selection === setSecrets) {
        await setGitHubActionsSecrets(repoInfo.owner, repoInfo.repo, {
            AZURE_CLIENT_ID: result.clientId,
            AZURE_TENANT_ID: result.tenantId,
            AZURE_SUBSCRIPTION_ID: result.subscriptionId,
        });
    } else if (selection === viewInstructions) {
        logger.show();
    }
}

/**
 * Authenticates with GitHub using the VS Code GitHub authentication extension
 * and sets repository secrets for GitHub Actions via the Octokit API.
 */
export async function setGitHubActionsSecrets(
    owner: string,
    repo: string,
    secrets: Record<string, string>,
): Promise<void> {
    // Step 1: Authenticate with GitHub
    let session: vscode.AuthenticationSession;
    try {
        const result = await vscode.authentication.getSession("github", ["repo"], {
            forceNewSession: { detail: l10n.t("GitHub authentication is required to set repository secrets.") },
        });

        if (!result) {
            vscode.window.showWarningMessage(l10n.t("GitHub authentication was cancelled."));
            return;
        }
        session = result;
    } catch (error) {
        logger.error("GitHub authentication failed", error);
        vscode.window.showErrorMessage(
            l10n.t("GitHub authentication failed. Please ensure the GitHub extension is installed and try again."),
        );
        return;
    }

    const octokit = new Octokit({ auth: `token ${session.accessToken}` });

    // Step 2: Verify the user has access to the repository
    try {
        const { data: repoData } = await octokit.repos.get({ owner, repo });

        // Check permissions — need admin or push access to set secrets
        const permissions = repoData.permissions;
        if (permissions && !permissions.admin && !permissions.push) {
            const contactAdmin = l10n.t("Contact Admin");
            const selection = await vscode.window.showErrorMessage(
                l10n.t(
                    "You don't have write access to {0}/{1}. Setting repository secrets requires admin or write permissions.",
                    owner,
                    repo,
                ),
                contactAdmin,
            );
            if (selection === contactAdmin) {
                vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${owner}/${repo}/settings/access`));
            }
            return;
        }
    } catch (error: unknown) {
        const statusCode = isOctokitError(error) ? error.status : undefined;

        if (statusCode === 401) {
            vscode.window.showErrorMessage(
                l10n.t("GitHub authentication token is invalid or expired. Please try again to re-authenticate."),
            );
        } else if (statusCode === 403) {
            const openSettings = l10n.t("Open Repo Settings");
            const selection = await vscode.window.showErrorMessage(
                l10n.t(
                    "You don't have permission to access {0}/{1}. Setting secrets requires admin or write access to the repository.",
                    owner,
                    repo,
                ),
                openSettings,
            );
            if (selection === openSettings) {
                vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${owner}/${repo}/settings/access`));
            }
        } else if (statusCode === 404) {
            vscode.window.showErrorMessage(
                l10n.t(
                    "Repository {0}/{1} was not found. Please verify the repository exists and you have access to it.",
                    owner,
                    repo,
                ),
            );
        } else {
            logger.error("Failed to verify repository access", error);
            vscode.window.showErrorMessage(
                l10n.t("Unable to reach GitHub. Please check your internet connection and try again."),
            );
        }
        return;
    }

    // Step 3: Fetch the repo public key and set secrets
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Setting GitHub Actions secrets"),
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: l10n.t("Fetching repository public key...") });

                let key: string;
                let keyId: string;
                try {
                    const resp = await octokit.actions.getRepoPublicKey({ owner, repo });
                    key = resp.data.key;
                    keyId = resp.data.key_id;
                } catch (error: unknown) {
                    const statusCode = isOctokitError(error) ? error.status : undefined;
                    if (statusCode === 403) {
                        throw new GitHubSecretsError(
                            l10n.t(
                                "You don't have permission to manage secrets for {0}/{1}. This requires admin access to the repository.",
                                owner,
                                repo,
                            ),
                        );
                    }
                    throw error;
                }

                // Ensure libsodium is ready
                await sodium.ready;

                const entries = Object.entries(secrets);
                const failedSecrets: string[] = [];

                for (let i = 0; i < entries.length; i++) {
                    const [name, value] = entries[i];
                    progress.report({
                        message: l10n.t("Setting secret {0} ({1}/{2})...", name, i + 1, entries.length),
                    });

                    try {
                        const encryptedValue = encryptSecret(key, value);

                        await octokit.actions.createOrUpdateRepoSecret({
                            owner,
                            repo,
                            secret_name: name,
                            encrypted_value: encryptedValue,
                            key_id: keyId,
                        });
                    } catch (error: unknown) {
                        logger.error(`Failed to set secret ${name}`, error);
                        failedSecrets.push(name);
                    }
                }

                if (failedSecrets.length > 0) {
                    const succeeded = entries.length - failedSecrets.length;
                    if (succeeded === 0) {
                        throw new GitHubSecretsError(
                            l10n.t(
                                "Failed to set any secrets on {0}/{1}. Please check your repository permissions.",
                                owner,
                                repo,
                            ),
                        );
                    } else {
                        vscode.window.showWarningMessage(
                            l10n.t(
                                "Set {0}/{1} secrets successfully. Failed: {2}",
                                succeeded,
                                entries.length,
                                failedSecrets.join(", "),
                            ),
                        );
                        return;
                    }
                }
            },
        );

        vscode.window.showInformationMessage(
            l10n.t("GitHub Actions secrets set successfully on {0}/{1}! Your workflow is ready to use.", owner, repo),
        );
    } catch (error) {
        if (error instanceof GitHubSecretsError) {
            vscode.window.showErrorMessage(error.message);
        } else {
            logger.error("Failed to set GitHub Actions secrets", error);
            vscode.window.showErrorMessage(
                l10n.t("Failed to set GitHub secrets: {0}", error instanceof Error ? error.message : String(error)),
            );
        }
    }
}

/** Custom error class for GitHub secrets-specific errors with user-friendly messages */
class GitHubSecretsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GitHubSecretsError";
    }
}

/** Type guard to check if an error is an Octokit RequestError (has a status property) */
function isOctokitError(error: unknown): error is { status: number; message: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        typeof (error as { status: unknown }).status === "number"
    );
}

/**
 * Encrypts a secret value using the repository's public key (NaCl sealed box).
 * GitHub requires secrets to be encrypted with the repo public key before being set.
 */
function encryptSecret(publicKeyBase64: string, secretValue: string): string {
    const publicKey = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
    const messageBytes = sodium.from_string(secretValue);
    const encryptedBytes = sodium.crypto_box_seal(messageBytes, publicKey);
    return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}
