import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { ManagedServiceIdentityClient } from "@azure/arm-msi";
import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import { ResourceManagementClient } from "@azure/arm-resources";
import { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";
import {
    createRoleAssignment,
    getScopeForAcr,
    getScopeForCluster,
    getScopeForManagedNamespace,
} from "../utils/roleAssignments";
import { getSessionProvider } from "../../auth/azureSessionProvider";
import { isReady } from "../../auth/types";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getCredential, getEnvironment } from "../../auth/azureAuth";
import { getPortalCreateUrl } from "../utils/env";
import { succeeded } from "../utils/errorable";
import { logger } from "./logger";
import { execFile } from "child_process";
import { promisify } from "util";
import type { TokenCredential } from "@azure/identity";
import { AzureContext } from "./azureSelections";
import { showWizardExitConfirmation } from "./wizardUtils";

const execFilePromise = promisify(execFile);

// Azure built-in role definition IDs
// https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
const AKS_CLUSTER_USER_ROLE_ID = "4abbcc35-e782-43d8-92c5-2d3f1bd2253f";
const AKS_RBAC_WRITER_ROLE_ID = "a7ffa36f-339b-4b5c-8bdf-e2c188b2c0eb";
const AKS_NAMESPACE_CONTRIBUTOR_ROLE_ID = "289d8817-ee69-43f1-a0af-43a45505b488";
const ACR_PUSH_ROLE_ID = "8311e382-0749-4cb8-b61a-304f252e45ec";
const ACR_TASKS_CONTRIBUTOR_ROLE_ID = "fb382eab-e894-4461-af04-94435c366c3f";

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
export async function setupOIDCForGitHub(
    workspaceFolder: vscode.WorkspaceFolder,
    appName: string,
    azureContext?: AzureContext,
): Promise<void> {
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
        const azureConfig = await promptForAzureConfig(appName, azureContext);
        if (!azureConfig) {
            return;
        }

        // Confirm before creating/updating the federated identity credential
        const federatedBranchPreview = repoInfo.mainBranch ?? "main";
        const federatedSubjectPreview = `repo:${repoInfo.owner}/${repoInfo.repo}:ref:refs/heads/${federatedBranchPreview}`;
        const identityAction = azureConfig.isExistingIdentity
            ? l10n.t("update existing managed identity")
            : l10n.t("create a new managed identity");
        const confirmMessage = l10n.t(
            "A Federated Identity Credential will be {0} in your Azure subscription.\n\nDetails:\n• Identity: {1}\n• Resource group: {2}\n• Subject: {3}\n• Issuer: https://token.actions.githubusercontent.com\n\nProceed?",
            identityAction,
            azureConfig.identityName,
            azureConfig.resourceGroup,
            federatedSubjectPreview,
        );
        const confirmed = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, l10n.t("Proceed"));
        if (!confirmed) {
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

                await assignRolePermissions(
                    credential,
                    azureConfig,
                    azureContext,
                    identityResult.principalId,
                    progress,
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

async function promptForAzureConfig(appName: string, azureContext?: AzureContext): Promise<AzureConfig | null> {
    // Get subscription
    const sessionProvider = await getSessionProvider();
    if (!isReady(sessionProvider)) {
        vscode.window.showErrorMessage(l10n.t("Not signed in to Azure. Please sign in first."));
        return null;
    }

    let subscriptionId: string;

    if (azureContext?.subscriptionId) {
        subscriptionId = azureContext.subscriptionId;
        logger.debug("OIDC: using subscription from AzureContext", subscriptionId);
    } else {
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
                void vscode.env.openExternal(
                    vscode.Uri.parse(
                        getPortalCreateUrl(getEnvironment(), "view/Microsoft_Azure_Billing/SubscriptionsBlade"),
                    ),
                );
            }
            return null;
        }

        const subItems = subscriptions.map((sub) => ({
            label: sub.displayName,
            description: sub.subscriptionId,
            subscriptionId: sub.subscriptionId,
        }));

        let selectedSub: (typeof subItems)[number] | undefined;
        while (!selectedSub) {
            selectedSub = await vscode.window.showQuickPick(subItems, {
                placeHolder: l10n.t("Select Azure subscription"),
                title: l10n.t("OIDC Setup - Subscription"),
            });
            if (!selectedSub) {
                if ((await showWizardExitConfirmation(async () => null)) === undefined) return null;
            }
        }

        subscriptionId = selectedSub.subscriptionId;
    }

    let resourceGroup: string | undefined;
    while (!resourceGroup) {
        resourceGroup = await vscode.window.showInputBox({
            prompt: l10n.t("Enter resource group name for the managed identity (will be created if it doesn't exist)"),
            value: `rg-${appName}-oidc`,
            title: l10n.t("OIDC Setup - Resource Group"),
            validateInput: (v) => (v.trim() ? undefined : l10n.t("Resource group name cannot be empty")),
        });
        if (resourceGroup === undefined) {
            if ((await showWizardExitConfirmation(async () => null)) === undefined) return null;
        }
    }

    // Get credential for listing identities
    const credential = getCredential(sessionProvider);

    // List existing managed identities in the resource group
    const existingIdentities = await listManagedIdentities(credential, subscriptionId, resourceGroup);

    let useExistingIdentity = false;
    let selectedIdentityName: string | null = null;

    if (existingIdentities.length > 0) {
        let identityChoice:
            | {
                  label: string;
                  description: string;
                  value: string;
              }
            | undefined;

        while (!identityChoice) {
            identityChoice = await vscode.window.showQuickPick(
                [
                    { label: l10n.t("Create new managed identity"), description: "", value: "new" },
                    { label: l10n.t("Use existing managed identity"), description: "", value: "existing" },
                ],
                {
                    placeHolder: l10n.t("Choose managed identity option"),
                    title: l10n.t("OIDC Setup - Managed Identity"),
                },
            );
            if (!identityChoice) {
                if ((await showWizardExitConfirmation(async () => null)) === undefined) return null;
            }
        }

        if (identityChoice.value === "existing") {
            useExistingIdentity = true;

            const identityItems = existingIdentities.map((identity) => ({
                label: identity.name,
                description: identity.clientId,
            }));

            let selectedIdentity: (typeof identityItems)[number] | undefined;
            while (!selectedIdentity) {
                selectedIdentity = await vscode.window.showQuickPick(identityItems, {
                    placeHolder: l10n.t("Select managed identity"),
                    title: l10n.t("OIDC Setup - Select Identity"),
                });
                if (!selectedIdentity) {
                    if ((await showWizardExitConfirmation(async () => null)) === undefined) return null;
                }
            }

            selectedIdentityName = selectedIdentity.label;
        }
    }

    let identityName: string;
    let location: string;

    if (useExistingIdentity && selectedIdentityName) {
        identityName = selectedIdentityName;
        location = "eastus"; // not used for existing identities
    } else {
        let newIdentityName: string | undefined;
        while (!newIdentityName) {
            newIdentityName = await vscode.window.showInputBox({
                prompt: l10n.t("Enter managed identity name"),
                value: `id-${appName}-github`,
                title: l10n.t("OIDC Setup - Identity Name"),
                validateInput: (v) => (v.trim() ? undefined : l10n.t("Identity name cannot be empty")),
            });
            if (newIdentityName === undefined) {
                if ((await showWizardExitConfirmation(async () => null)) === undefined) return null;
            }
        }
        identityName = newIdentityName;

        let newLocation: string | undefined;
        while (!newLocation) {
            newLocation = await vscode.window.showInputBox({
                prompt: l10n.t("Enter Azure region"),
                value: "eastus",
                title: l10n.t("OIDC Setup - Location"),
                validateInput: (v) => (v.trim() ? undefined : l10n.t("Location cannot be empty")),
            });
            if (newLocation === undefined) {
                if ((await showWizardExitConfirmation(async () => null)) === undefined) return null;
            }
        }
        location = newLocation;
    }

    return {
        subscriptionId,
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

/**
 * Assigns the correct roles based on namespace type.
 * When invoked from pipeline generation we have cluster/ns context; otherwise we fall back
 * to a resource-group scope assignment that keeps the standalone command working.
 */
async function assignRolePermissions(
    credential: TokenCredential,
    azureConfig: AzureConfig,
    azureContext: AzureContext | undefined,
    principalId: string,
    progress: vscode.Progress<{ message?: string }>,
): Promise<void> {
    // TODO: When invoked without cluster context we cannot determine the correct
    // scopes for role assignments. This path will be addressed in future work. (Need to ask for cluster/resource group)
    if (!azureContext?.clusterName || !azureContext.clusterResourceGroup) {
        return;
    }

    // Managed namespace — assign managed-ns deployment roles
    if (
        azureContext.isManagedNamespace &&
        azureContext.namespace &&
        azureContext.acrName &&
        azureContext.acrResourceGroup
    ) {
        progress.report({ message: l10n.t("Assigning deployment roles...") });
        await assignManagedNamespaceDeploymentRoles(
            credential,
            azureConfig.subscriptionId,
            azureContext.clusterResourceGroup,
            azureContext.clusterName,
            azureContext.namespace,
            azureContext.acrResourceGroup,
            azureContext.acrName,
            principalId,
        );
        return;
    }

    // User namespace — cluster user role + optional deployment roles
    if (!azureContext.isManagedNamespace) {
        await assignAksClusterUserRole(
            credential,
            azureConfig.subscriptionId,
            azureContext.clusterResourceGroup,
            principalId,
        );

        if (azureContext.acrName && azureContext.acrResourceGroup) {
            progress.report({ message: l10n.t("Assigning deployment roles...") });
            await assignUserNamespaceDeploymentRoles(
                credential,
                azureConfig.subscriptionId,
                azureContext.clusterResourceGroup,
                azureContext.clusterName,
                azureContext.acrResourceGroup,
                azureContext.acrName,
                principalId,
            );
        }
    }
}

async function assignAksClusterUserRole(
    credential: TokenCredential,
    subscriptionId: string,
    resourceGroup: string,
    principalId: string,
): Promise<void> {
    const authClient = new AuthorizationManagementClient(credential, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;

    const result = await createRoleAssignment(
        authClient,
        subscriptionId,
        principalId,
        AKS_CLUSTER_USER_ROLE_ID,
        scope,
        "ServicePrincipal",
    );

    if (!result.succeeded) {
        throw new Error(result.error);
    }
}

async function isAzureRbacEnabledForCluster(
    credential: TokenCredential,
    subscriptionId: string,
    clusterResourceGroup: string,
    clusterName: string,
): Promise<boolean> {
    try {
        const aksClient = new ContainerServiceClient(credential, subscriptionId, {
            endpoint: getEnvironment().resourceManagerEndpointUrl,
        });
        const cluster = await aksClient.managedClusters.get(clusterResourceGroup, clusterName);
        const enabled =
            (cluster as unknown as { aadProfile?: { enableAzureRBAC?: boolean; enableAzureRbac?: boolean } }).aadProfile
                ?.enableAzureRBAC ??
            (cluster as unknown as { aadProfile?: { enableAzureRBAC?: boolean; enableAzureRbac?: boolean } }).aadProfile
                ?.enableAzureRbac;
        return enabled === true;
    } catch (error) {
        logger.warn(
            `Failed to determine if Azure RBAC is enabled for cluster '${clusterName}': ${error instanceof Error ? error.message : String(error)}. Skipping conditional role assignment.`,
        );
        return false;
    }
}

async function assignUserNamespaceDeploymentRoles(
    credential: TokenCredential,
    subscriptionId: string,
    clusterResourceGroup: string,
    clusterName: string,
    acrResourceGroup: string,
    acrName: string,
    principalId: string,
): Promise<void> {
    const authClient = new AuthorizationManagementClient(credential, subscriptionId);
    const warnings: string[] = [];

    const clusterScope = getScopeForCluster(subscriptionId, clusterResourceGroup, clusterName);
    const acrScope = getScopeForAcr(subscriptionId, acrResourceGroup, acrName);

    const [acrPushResult, acrTasksResult] = await Promise.all([
        createRoleAssignment(authClient, subscriptionId, principalId, ACR_PUSH_ROLE_ID, acrScope, "ServicePrincipal"),
        createRoleAssignment(
            authClient,
            subscriptionId,
            principalId,
            ACR_TASKS_CONTRIBUTOR_ROLE_ID,
            acrScope,
            "ServicePrincipal",
        ),
    ]);

    if (!acrPushResult.succeeded) {
        logger.warn(`AcrPush assignment: ${acrPushResult.error}`);
        warnings.push(l10n.t("AcrPush"));
    }
    if (!acrTasksResult.succeeded) {
        logger.warn(`Container Registry Tasks Contributor assignment: ${acrTasksResult.error}`);
        warnings.push(l10n.t("Container Registry Tasks Contributor"));
    }

    // Only assign AKS RBAC Writer at cluster scope when Azure RBAC is enabled on the cluster.
    const azureRbacEnabled = await isAzureRbacEnabledForCluster(
        credential,
        subscriptionId,
        clusterResourceGroup,
        clusterName,
    );
    if (azureRbacEnabled) {
        const rbacResult = await createRoleAssignment(
            authClient,
            subscriptionId,
            principalId,
            AKS_RBAC_WRITER_ROLE_ID,
            clusterScope,
            "ServicePrincipal",
        );
        if (!rbacResult.succeeded) {
            logger.warn(`AKS RBAC Writer assignment: ${rbacResult.error}`);
            warnings.push(l10n.t("AKS RBAC Writer"));
        }
    }

    if (warnings.length > 0) {
        vscode.window.showWarningMessage(
            l10n.t(
                "Some deployment role assignments failed: {0}. You may need to assign them manually.",
                warnings.join(", "),
            ),
        );
    }
}

async function assignManagedNamespaceDeploymentRoles(
    credential: TokenCredential,
    subscriptionId: string,
    clusterResourceGroup: string,
    clusterName: string,
    namespace: string,
    acrResourceGroup: string,
    acrName: string,
    principalId: string,
): Promise<void> {
    const authClient = new AuthorizationManagementClient(credential, subscriptionId);
    const warnings: string[] = [];

    const managedNsScope = getScopeForManagedNamespace(subscriptionId, clusterResourceGroup, clusterName, namespace);
    const acrScope = getScopeForAcr(subscriptionId, acrResourceGroup, acrName);

    // Assign all roles concurrently — they are independent
    const [rbacResult, nsContribResult, acrResult, acrTasksResult] = await Promise.all([
        // K8s data-plane access (deployments, configmaps, etc.)
        createRoleAssignment(
            authClient,
            subscriptionId,
            principalId,
            AKS_RBAC_WRITER_ROLE_ID,
            managedNsScope,
            "ServicePrincipal",
        ),
        // ARM access to fetch namespace-scoped kubeconfig
        createRoleAssignment(
            authClient,
            subscriptionId,
            principalId,
            AKS_NAMESPACE_CONTRIBUTOR_ROLE_ID,
            managedNsScope,
            "ServicePrincipal",
        ),
        // ACR push access for container images
        createRoleAssignment(authClient, subscriptionId, principalId, ACR_PUSH_ROLE_ID, acrScope, "ServicePrincipal"),
        // ACR Tasks Contributor for az acr build
        createRoleAssignment(
            authClient,
            subscriptionId,
            principalId,
            ACR_TASKS_CONTRIBUTOR_ROLE_ID,
            acrScope,
            "ServicePrincipal",
        ),
    ]);

    if (!rbacResult.succeeded) {
        logger.warn(`AKS RBAC Writer assignment: ${rbacResult.error}`);
        warnings.push(l10n.t("AKS RBAC Writer"));
    }
    if (!nsContribResult.succeeded) {
        logger.warn(`AKS Namespace Contributor assignment: ${nsContribResult.error}`);
        warnings.push(l10n.t("AKS Namespace Contributor"));
    }
    if (!acrResult.succeeded) {
        logger.warn(`AcrPush assignment: ${acrResult.error}`);
        warnings.push(l10n.t("AcrPush"));
    }
    if (!acrTasksResult.succeeded) {
        logger.warn(`Container Registry Tasks Contributor assignment: ${acrTasksResult.error}`);
        warnings.push(l10n.t("Container Registry Tasks Contributor"));
    }

    if (warnings.length > 0) {
        vscode.window.showWarningMessage(
            l10n.t(
                "Some deployment role assignments failed: {0}. You may need to assign them manually.",
                warnings.join(", "),
            ),
        );
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

async function displayOIDCResults(
    result: OIDCSetupResult,
    repoInfo: { owner: string; repo: string; branch: string; mainBranch?: string },
): Promise<void> {
    // Show success information to user
    const message = l10n.t(
        "Managed Identity configured. Add the identity details to your repository secrets to complete the pipeline setup.",
    );
    const setSecrets = l10n.t("Set secrets");
    const copyAll = l10n.t("Copy secrets and set manually");
    const viewInstructions = l10n.t("View Output");

    const secretsText = `AZURE_CLIENT_ID: ${result.clientId}
AZURE_TENANT_ID: ${result.tenantId}
AZURE_SUBSCRIPTION_ID: ${result.subscriptionId}`;

    const federatedBranch = repoInfo.mainBranch ?? "main";
    const federatedSubject = `repo:${repoInfo.owner}/${repoInfo.repo}:ref:refs/heads/${federatedBranch}`;

    const selection = await vscode.window.showInformationMessage(message, setSecrets, copyAll, viewInstructions);

    if (selection === setSecrets) {
        await setGitHubActionsSecrets(repoInfo.owner, repoInfo.repo, {
            AZURE_CLIENT_ID: result.clientId,
            AZURE_TENANT_ID: result.tenantId,
            AZURE_SUBSCRIPTION_ID: result.subscriptionId,
        });
    } else if (selection === copyAll) {
        await vscode.env.clipboard.writeText(secretsText);
        vscode.window.showInformationMessage(l10n.t("Secrets copied to clipboard!"));
    } else if (selection === viewInstructions) {
        logger.info("--- Managed Identity / OIDC Setup Complete ---");
        logger.info(`Identity:         ${result.identityName}`);
        logger.info(`Resource group:   ${result.resourceGroup}`);
        logger.info(`Subscription:     ${result.subscriptionId}`);
        logger.info(`GitHub repo:      ${repoInfo.owner}/${repoInfo.repo}`);
        logger.info(`Federated branch: ${federatedBranch} (subject: ${federatedSubject})`);
        logger.info(`Required GitHub Actions secrets:\n${secretsText}`);
        logger.show();
    }
}

/** Creates an Octokit client for the given token. Exported for testability. */
export function createOctokitClient(token: string): Octokit {
    return new Octokit({ auth: `token ${token}` });
}

/**
 * Authenticates with GitHub using the VS Code GitHub authentication extension
 * and sets repository secrets for GitHub Actions via the Octokit API.
 *
 * Returns `true` if all secrets were set successfully, `false` otherwise.
 * On failure, shows an error dialog with "Copy Secrets" / "View Output"
 * fallback buttons so the user can still retrieve their secret values.
 */
export async function setGitHubActionsSecrets(
    owner: string,
    repo: string,
    secrets: Record<string, string>,
): Promise<boolean> {
    // Build a copyable text of the secrets for fallback buttons on error dialogs.
    const secretsText = Object.entries(secrets)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");

    /** Shows an error message with "Copy Secrets" / "View Output" fallback buttons. */
    async function showError(message: string): Promise<void> {
        const copySecrets = l10n.t("Copy Secrets");
        const viewOutput = l10n.t("View Output");
        const selection = await vscode.window.showErrorMessage(message, copySecrets, viewOutput);
        if (selection === copySecrets) {
            await vscode.env.clipboard.writeText(secretsText);
            vscode.window.showInformationMessage(l10n.t("Secrets copied to clipboard!"));
        } else if (selection === viewOutput) {
            logger.show();
        }
    }

    /**
     * Shows an SSO error with "Authorize Token" plus fallback buttons.
     * Opens the SSO authorization URL if the user clicks "Authorize Token".
     */
    async function showSSOError(message: string, ssoUrl: string): Promise<void> {
        const authorize = l10n.t("Authorize Token");
        const copySecrets = l10n.t("Copy Secrets");
        const viewOutput = l10n.t("View Output");
        const selection = await vscode.window.showErrorMessage(message, authorize, copySecrets, viewOutput);
        if (selection === authorize) {
            vscode.env.openExternal(vscode.Uri.parse(ssoUrl));
        } else if (selection === copySecrets) {
            await vscode.env.clipboard.writeText(secretsText);
            vscode.window.showInformationMessage(l10n.t("Secrets copied to clipboard!"));
        } else if (selection === viewOutput) {
            logger.show();
        }
    }

    // Step 1: Authenticate with GitHub
    let session: vscode.AuthenticationSession;
    try {
        session = await vscode.authentication.getSession("github", ["repo"], {
            createIfNone: true,
        });
    } catch (error) {
        logger.error("GitHub authentication failed", error);
        await showError(
            l10n.t("GitHub authentication failed. Please ensure the GitHub extension is installed and try again."),
        );
        return false;
    }

    // Call through `exports` so the function is stubbable in tests (CJS binds
    // local names at definition time, not at call time).
    const octokit = (exports as { createOctokitClient: typeof createOctokitClient }).createOctokitClient(
        session.accessToken,
    );

    // Step 2: Verify the user has access to the repository (repo access check)
    try {
        const { data: repoData } = await octokit.repos.get({ owner, repo });

        if (repoData.archived) {
            await showError(
                l10n.t("Repository {0}/{1} is archived. Secrets cannot be set on archived repositories.", owner, repo),
            );
            return false;
        }

        // Check permissions — need admin or push access to set secrets
        const permissions = repoData.permissions;
        if (permissions && !permissions.admin && !permissions.push) {
            await showError(
                l10n.t(
                    "You don't have write access to {0}/{1}. Setting repository secrets requires admin or write permissions. Contact the repository admin to request access.",
                    owner,
                    repo,
                ),
            );
            return false;
        }
    } catch (error: unknown) {
        await handleReposGetError(error, owner, repo, showError, showSSOError);
        return false;
    }

    // Step 3: Fetch the repo public key and set secrets
    try {
        const hasFailures = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Setting GitHub Actions secrets"),
                cancellable: false,
            },
            async (progress): Promise<boolean> => {
                progress.report({ message: l10n.t("Fetching repository public key...") });

                let key: string;
                let keyId: string;
                try {
                    const resp = await octokit.actions.getRepoPublicKey({ owner, repo });
                    key = resp.data.key;
                    keyId = resp.data.key_id;
                } catch (error: unknown) {
                    const statusCode = isOctokitError(error) ? error.status : undefined;
                    const ssoUrl = statusCode === 403 ? getSAMLSSOUrl(error) : undefined;

                    if (statusCode === 403 && ssoUrl) {
                        throw new GitHubSecretsError(
                            l10n.t(
                                "This organization requires SAML SSO authorization to manage secrets. Please authorize your token and try again.",
                            ),
                            ssoUrl,
                        );
                    }

                    if (statusCode === 403) {
                        throw new GitHubSecretsError(
                            l10n.t(
                                "You don't have permission to manage secrets for {0}/{1}. This requires admin access to the repository.",
                                owner,
                                repo,
                            ),
                        );
                    }

                    throw new GitHubSecretsError(
                        l10n.t(
                            "Failed to fetch the repository encryption key for {0}/{1}. Please check your connection and try again.",
                            owner,
                            repo,
                        ),
                    );
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

                if (failedSecrets.length === 0) {
                    return false; // no failures
                }

                const succeededCount = entries.length - failedSecrets.length;
                if (succeededCount === 0) {
                    throw new GitHubSecretsError(
                        l10n.t(
                            "Failed to set any secrets on {0}/{1}. Please check your repository permissions.",
                            owner,
                            repo,
                        ),
                    );
                }

                vscode.window.showWarningMessage(
                    l10n.t(
                        "{0}/{1} secrets were set. Could not set: {2}. Add the missing secrets manually.",
                        succeededCount,
                        entries.length,
                        failedSecrets.join(", "),
                    ),
                );
                return true; // had failures
            },
        );

        if (hasFailures) {
            return false;
        }

        vscode.window.showInformationMessage(
            l10n.t("GitHub Actions secrets set successfully on {0}/{1}. Your pipeline is ready to run.", owner, repo),
        );
        return true;
    } catch (error) {
        if (!(error instanceof GitHubSecretsError)) {
            logger.error("Failed to set GitHub Actions secrets", error);
            await showError(
                l10n.t("Failed to set GitHub secrets: {0}", error instanceof Error ? error.message : String(error)),
            );
            return false;
        }

        if (error.ssoUrl) {
            await showSSOError(error.message, error.ssoUrl);
            return false;
        }

        await showError(error.message);
        return false;
    }
}

/**
 * Handles errors from octokit.repos.get() during the repo access check.
 * Each error case shows a specific user-facing message and returns.
 */
async function handleReposGetError(
    error: unknown,
    owner: string,
    repo: string,
    showError: (message: string) => Promise<void>,
    showSSOError: (message: string, ssoUrl: string) => Promise<void>,
): Promise<void> {
    const statusCode = isOctokitError(error) ? error.status : undefined;

    if (statusCode === 401) {
        await showError(
            l10n.t("GitHub authentication token is invalid or expired. Please try again to re-authenticate."),
        );
        return;
    }

    if (statusCode === 403) {
        const ssoUrl = getSAMLSSOUrl(error);
        if (ssoUrl) {
            await showSSOError(
                l10n.t(
                    "This organization requires SAML SSO. You must authorize your GitHub token for this organization before setting secrets.",
                ),
                ssoUrl,
            );
            return;
        }

        await showError(
            l10n.t(
                "You don't have permission to access {0}/{1}. Setting secrets requires admin or write access to the repository. Contact the repository admin to request access.",
                owner,
                repo,
            ),
        );
        return;
    }

    if (statusCode === 404) {
        await showError(
            l10n.t(
                "Repository {0}/{1} was not found. Please verify the repository exists and you have access to it.",
                owner,
                repo,
            ),
        );
        return;
    }

    logger.error("Failed to verify repository access", error);
    await showError(l10n.t("Unable to reach GitHub. Please check your internet connection and try again."));
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Custom error class for GitHub secrets-specific errors with user-friendly messages */
export class GitHubSecretsError extends Error {
    readonly ssoUrl?: string;
    constructor(message: string, ssoUrl?: string) {
        super(message);
        this.name = "GitHubSecretsError";
        this.ssoUrl = ssoUrl;
    }
}

/** Type guard to check if an error is an Octokit RequestError (has a status property) */
export function isOctokitError(error: unknown): error is { status: number; message: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        typeof (error as { status: unknown }).status === "number"
    );
}

/**
 * Extracts the SAML SSO authorization URL from an Octokit error, if present.
 * GitHub returns a `X-GitHub-SSO` response header with format `required; url=<authorization_url>`
 * when a token has not been authorized for an organization that enforces SAML SSO.
 */
export function getSAMLSSOUrl(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("response" in error)) {
        return undefined;
    }

    const response = (error as { response: unknown }).response;
    if (typeof response !== "object" || response === null || !("headers" in response)) {
        return undefined;
    }

    const headers = (response as { headers: Record<string, unknown> }).headers;
    const ssoHeader = headers?.["x-github-sso"];
    if (typeof ssoHeader !== "string" || !ssoHeader.startsWith("required;")) {
        return undefined;
    }

    const match = ssoHeader.match(/url=(.+)$/);
    return match?.[1];
}

/**
 * Encrypts a secret value using the repository's public key (NaCl sealed box).
 * GitHub requires secrets to be encrypted with the repo public key before being set.
 */
export function encryptSecret(publicKeyBase64: string, secretValue: string): string {
    const publicKey = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
    const messageBytes = sodium.from_string(secretValue);
    const encryptedBytes = sodium.crypto_box_seal(messageBytes, publicKey);
    return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}
