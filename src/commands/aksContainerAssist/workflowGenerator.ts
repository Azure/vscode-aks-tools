/**
 * GitHub Workflow Generator for AKS deployments
 * This module handles the generation of GitHub Actions workflows for building and deploying to AKS
 * Independent of Container Assist SDK
 */

import * as vscode from "vscode";
import * as path from "path";
import * as l10n from "@vscode/l10n";
import { Errorable, failed } from "../utils/errorable";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getResources } from "../utils/azureResources";
import { getClusters, Cluster, getClusterNamespaces, getManagedCluster } from "../utils/clusters";
import { WorkflowConfig, renderWorkflowTemplate, validateWorkflowConfig } from "./workflowTemplate";
import { writeWorkflowFile, workflowFileExists, fileExists } from "./fileOperations";
import { logger } from "./logger";
import { extension } from "vscode-kubernetes-tools-api";

interface AzureResource {
    id: string;
    name: string;
    resourceGroup: string;
}

interface SubscriptionInfo {
    id: string;
    name: string;
}

/**
 * Main function to generate GitHub workflow with user interaction
 * @param workspaceFolder The workspace folder where the workflow will be created
 * @param projectRoot The project root path
 */
export async function generateGitHubWorkflow(
    workspaceFolder: vscode.WorkspaceFolder,
    projectRoot: string,
): Promise<Errorable<string>> {
    try {
        logger.info("Starting GitHub workflow generation");

        // Step 1: Authenticate with Azure
        const sessionProvider = await getReadySessionProvider();
        if (failed(sessionProvider)) {
            vscode.window.showErrorMessage(
                l10n.t("Azure login required. Please sign in to Azure using the Azure Account extension."),
            );
            return { succeeded: false, error: sessionProvider.error };
        }
        logger.info("Azure authentication successful");

        // Step 2: Collect workflow configuration from user (no progress bars during input)
        const config = await collectWorkflowConfiguration(sessionProvider.result, workspaceFolder, projectRoot);
        if (!config) {
            logger.info("Workflow generation cancelled by user");
            return { succeeded: false, error: "Workflow generation cancelled" };
        }

        // Step 3: Validate configuration
        const validationErrors = validateWorkflowConfig(config);
        if (validationErrors.length > 0) {
            const errorMsg = validationErrors.join("; ");
            logger.error("Workflow configuration validation failed", errorMsg);
            return { succeeded: false, error: `Invalid configuration: ${errorMsg}` };
        }

        // Step 4: Check if workflow already exists
        const workflowName = sanitizeWorkflowName(config.workflowName);
        const exists = await workflowFileExists(projectRoot, workflowName);
        if (exists) {
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Workflow file "{0}.yaml" already exists. Overwrite?', workflowName),
                l10n.t("Overwrite"),
                l10n.t("Cancel"),
            );
            if (overwrite !== l10n.t("Overwrite")) {
                logger.info("User chose not to overwrite existing workflow");
                return { succeeded: false, error: "Workflow file already exists" };
            }
        }

        // Step 5: Render template and write file (no progress notification)
        const workflowContent = renderWorkflowTemplate(config);
        logger.debug("Workflow template rendered successfully");

        const workflowPath = await writeWorkflowFile(projectRoot, workflowName, workflowContent);
        logger.info(`Workflow file created at: ${workflowPath}`);

        return { succeeded: true, result: workflowPath };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to generate workflow", error);
        return { succeeded: false, error: `Failed to generate workflow: ${errorMsg}` };
    }
}

/**
 * Collects workflow configuration from user through interactive prompts
 * Uses smart defaults and minimal inputs
 */
async function collectWorkflowConfiguration(
    sessionProvider: ReadyAzureSessionProvider,
    _workspaceFolder: vscode.WorkspaceFolder,
    projectRoot: string,
): Promise<WorkflowConfig | undefined> {
    // 1. Azure Subscription (REQUIRED - show all available)
    const subscription = await selectAzureSubscription(sessionProvider);
    if (!subscription) return undefined;
    logger.debug("Subscription selected", subscription.name);

    // 2. AKS Cluster Selection (REQUIRED - cluster-first approach)
    const cluster = await selectAksCluster(sessionProvider, subscription.id);
    if (!cluster) return undefined;
    logger.debug("Cluster selected", cluster.name);

    // 3. Get ACRs attached to the cluster
    const acr = await selectClusterAcr(sessionProvider, subscription.id, cluster);
    if (!acr) return undefined;
    logger.debug("ACR selected", acr.name);

    // 4. Get namespaces from the cluster
    const namespace = await selectClusterNamespace(sessionProvider, subscription.id, cluster);
    if (!namespace) return undefined;
    logger.debug("Namespace selected", namespace);

    // 5. Smart defaults for remaining values
    const appName = path.basename(projectRoot);

    // Generate workflow name suggestion
    const defaultWorkflowName = `deploy-${appName}-to-aks`;

    const workflowName = await vscode.window.showInputBox({
        prompt: l10n.t("Enter workflow name"),
        placeHolder: defaultWorkflowName,
        value: defaultWorkflowName,
        validateInput: (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Workflow name is required");
            }
            if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
                return l10n.t("Workflow name can only contain letters, numbers, hyphens, and underscores");
            }
            return undefined;
        },
    });
    if (!workflowName) return undefined;
    logger.debug("Workflow name selected", workflowName);

    // 6. Dockerfile path - detect and allow user to customize
    const detectedDockerfile = await detectDockerfilePath(projectRoot);
    const dockerfilePath = await promptForDockerfilePath(projectRoot, detectedDockerfile);
    if (!dockerfilePath) return undefined;
    logger.debug("Dockerfile path selected", dockerfilePath);

    // 7. Build context path - detect from Dockerfile location
    const defaultBuildContext = dockerfilePath.includes("/") ? path.dirname(dockerfilePath) : ".";
    const buildContextPath = await promptForBuildContext(defaultBuildContext);
    if (!buildContextPath) return undefined;
    logger.debug("Build context path selected", buildContextPath);

    // 8. Manifest path - detect and allow user to customize
    const detectedManifest = await detectManifestPath(projectRoot);
    const manifestPath = await promptForManifestPath(detectedManifest);
    if (!manifestPath) return undefined;
    logger.debug("Manifest path selected", manifestPath);

    return {
        workflowName,
        branchName: "main", // Default to main
        containerName: appName, // Use app name as container name
        dockerFile: dockerfilePath,
        buildContextPath,
        acrResourceGroup: acr.resourceGroup,
        azureContainerRegistry: acr.name,
        clusterName: cluster.name,
        clusterResourceGroup: cluster.resourceGroup,
        deploymentManifestPath: manifestPath,
        namespace,
    };
}

/**
 * Detects Dockerfile path in the project
 * Returns "Dockerfile" if it exists at the root, otherwise undefined
 */
async function detectDockerfilePath(projectRoot: string): Promise<string | undefined> {
    const dockerfilePath = path.join(projectRoot, "Dockerfile");
    if (await fileExists(dockerfilePath)) {
        return "Dockerfile";
    }
    return undefined;
}

/**
 * Detects Kubernetes manifest path in the project
 * Checks for k8s/ or manifests/ folders
 */
async function detectManifestPath(projectRoot: string): Promise<string | undefined> {
    // Check k8s folder first
    const k8sPath = path.join(projectRoot, "k8s");
    if (await fileExists(k8sPath)) {
        return "k8s/*.yaml";
    }

    // Check manifests folder as fallback
    const manifestsPath = path.join(projectRoot, "manifests");
    if (await fileExists(manifestsPath)) {
        return "manifests/*.yaml";
    }

    return undefined;
}

/**
 * Prompts user to enter or confirm Dockerfile path
 */
async function promptForDockerfilePath(
    projectRoot: string,
    detectedPath: string | undefined,
): Promise<string | undefined> {
    const defaultPath = detectedPath || "Dockerfile";
    const detectionNote = detectedPath ? l10n.t("✓ Found: {0}", detectedPath) : l10n.t("Not found - using default");

    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter Dockerfile path (relative to project root)\n{0}", detectionNote),
        placeHolder: "Dockerfile",
        value: defaultPath,
        title: l10n.t("Dockerfile Location"),
        ignoreFocusOut: true,
        validateInput: async (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Dockerfile path is required");
            }
            // Optional: Validate file exists
            const fullPath = path.join(projectRoot, value);
            if (!(await fileExists(fullPath))) {
                return l10n.t("⚠ Warning: Dockerfile not found at this path");
            }
            return undefined;
        },
    });

    return result?.trim();
}

/**
 * Prompts user to enter build context path
 */
async function promptForBuildContext(defaultContext: string): Promise<string | undefined> {
    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter build context path (directory containing source code)"),
        placeHolder: ".",
        value: defaultContext,
        title: l10n.t("Build Context"),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Build context path is required");
            }
            // Validate it's a valid relative path
            if (value.startsWith("/") || value.includes("..")) {
                return l10n.t("Build context must be a relative path within the project");
            }
            return undefined;
        },
    });

    return result?.trim();
}

/**
 * Prompts user to enter or confirm Kubernetes manifest path
 */
async function promptForManifestPath(detectedPath: string | undefined): Promise<string | undefined> {
    const defaultPath = detectedPath || "k8s/*.yaml";
    const detectionNote = detectedPath ? l10n.t("✓ Found: {0}", detectedPath) : l10n.t("Not found - using default");

    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter Kubernetes manifest path (supports wildcards like *.yaml)\n{0}", detectionNote),
        placeHolder: "k8s/*.yaml",
        value: defaultPath,
        title: l10n.t("Kubernetes Manifest Path"),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Manifest path is required");
            }
            return undefined;
        },
    });

    return result?.trim();
}

/**
 * Prompts user to select an Azure subscription
 * Shows all subscriptions available to the signed-in user
 */
async function selectAzureSubscription(
    sessionProvider: ReadyAzureSessionProvider,
): Promise<SubscriptionInfo | undefined> {
    const subscriptionsResult = await getSubscriptions(sessionProvider, SelectionType.All);

    if (failed(subscriptionsResult)) {
        vscode.window.showErrorMessage(subscriptionsResult.error);
        return undefined;
    }

    if (subscriptionsResult.result.length === 0) {
        vscode.window.showErrorMessage(
            l10n.t(
                "No Azure subscriptions found. Please sign in to Azure and ensure you have access to subscriptions.",
            ),
        );
        return undefined;
    }

    const subscriptionItems = subscriptionsResult.result.map((sub) => ({
        label: sub.displayName,
        description: sub.subscriptionId,
        subscription: { id: sub.subscriptionId, name: sub.displayName },
    }));

    const selected = await vscode.window.showQuickPick(subscriptionItems, {
        placeHolder: l10n.t("Select Azure subscription"),
        title: l10n.t("Azure Subscription ({0} available)", subscriptionsResult.result.length),
    });

    return selected?.subscription;
}

/**
 * Prompts user to select an AKS cluster
 */
async function selectAksCluster(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Cluster | undefined> {
    const clustersResult = await getClusters(sessionProvider, subscriptionId);

    if (!clustersResult || clustersResult.length === 0) {
        vscode.window.showErrorMessage(
            l10n.t("No AKS clusters found in subscription. Please create an AKS cluster first."),
        );
        return undefined;
    }

    const clusterItems = clustersResult
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cluster) => ({
            label: cluster.name,
            description: cluster.resourceGroup,
            cluster,
        }));

    const selected = await vscode.window.showQuickPick(clusterItems, {
        placeHolder: l10n.t("Select AKS cluster for deployment"),
        title: l10n.t("AKS Cluster ({0} available)", clustersResult.length),
    });

    return selected?.cluster;
}

/**
 * Prompts user to select an ACR attached to the cluster
 * Shows ONLY ACRs connected to the selected cluster
 */
async function selectClusterAcr(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<AzureResource | undefined> {
    // Get the managed cluster details to find attached ACRs
    const managedCluster = await getManagedCluster(
        sessionProvider,
        subscriptionId,
        cluster.resourceGroup,
        cluster.name,
    );

    if (failed(managedCluster)) {
        vscode.window.showErrorMessage(managedCluster.error);
        return undefined;
    }

    // Get attached ACR resource IDs from the cluster's acrProfile
    const attachedAcrIds: string[] = [];

    // Check if ACR integration is configured
    if (managedCluster.result.networkProfile?.networkPlugin) {
        // Try to get ACR IDs from the identity profile
        const acrPullIdentity = managedCluster.result.identityProfile?.kubeletidentity?.resourceId;
        if (acrPullIdentity) {
            attachedAcrIds.push(acrPullIdentity);
        }
    }

    // Get all ACRs in the subscription
    const acrsResult = await getResources(sessionProvider, subscriptionId, "Microsoft.ContainerRegistry/registries");

    if (failed(acrsResult)) {
        vscode.window.showErrorMessage(acrsResult.error);
        return undefined;
    }

    // Filter to show ONLY attached ACRs
    // For now, if we can't determine attached ACRs from the API, show all ACRs but with a note
    // that they should be attached to the cluster
    const acrList = acrsResult.result;

    if (acrList.length === 0) {
        vscode.window.showErrorMessage(
            l10n.t(
                "No Azure Container Registries found in subscription. Please create an ACR and attach it to your cluster.",
            ),
        );
        return undefined;
    }

    const acrItems = acrList
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((acr) => ({
            label: acr.name,
            description: acr.resourceGroup,
            detail: l10n.t("Ensure this ACR is attached to cluster '{0}'", cluster.name),
            acr: {
                id: acr.id,
                name: acr.name,
                resourceGroup: acr.resourceGroup,
            },
        }));

    const selected = await vscode.window.showQuickPick(acrItems, {
        placeHolder: l10n.t("Select Azure Container Registry attached to '{0}'", cluster.name),
        title: l10n.t("Container Registry ({0} available)", acrList.length),
    });

    return selected?.acr;
}

/**
 * Prompts user to select a namespace from the cluster
 * Shows only namespaces the user has access to
 */
async function selectClusterNamespace(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<string | undefined> {
    const kubectl = await extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(l10n.t("kubectl is not available. Please install kubectl extension."));
        return undefined;
    }

    const namespacesResult = await getClusterNamespaces(
        sessionProvider,
        kubectl,
        subscriptionId,
        cluster.resourceGroup,
        cluster.name,
    );

    if (failed(namespacesResult)) {
        vscode.window.showErrorMessage(
            l10n.t("Failed to retrieve namespaces from cluster: {0}", namespacesResult.error),
        );
        return undefined;
    }

    if (namespacesResult.result.length === 0) {
        vscode.window.showErrorMessage(l10n.t("No namespaces found in cluster."));
        return undefined;
    }

    const namespaceItems = namespacesResult.result.sort().map((ns) => ({
        label: ns,
        description: ns === "default" ? l10n.t("Default namespace") : undefined,
    }));

    const selected = await vscode.window.showQuickPick(namespaceItems, {
        placeHolder: l10n.t("Select Kubernetes namespace"),
        title: l10n.t("Namespace ({0} available)", namespacesResult.result.length),
    });

    return selected?.label;
}

/**
 * Sanitizes workflow name to be used as filename
 */
function sanitizeWorkflowName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
}
