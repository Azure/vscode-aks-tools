import * as vscode from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import {
    InitialState,
    TelemetryDefinition,
    ToVsCodeMsgDef,
    ToWebviewMessageSink,
} from "../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { DeveloperHubServiceClient, Workflow } from "@azure/arm-devhub";
import { ResourceGroup as ARMResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { ReadyAzureSessionProvider } from "../auth/types";
import { Octokit } from "@octokit/rest";
import { ToWebViewMsgDef, ResourceGroup, AcrKey } from "../webview-contract/webviewDefinitions/automatedDeployments";
import { SelectionType, getSubscriptions } from "../commands/utils/subscriptions";
import * as roleAssignmentsUtil from "../../src/commands/utils/roleAssignments";
import { Errorable, failed } from "../commands/utils/errorable";
import * as acrUtils from "../commands/utils/acrs";
import { getResourceGroups } from "../commands/utils/resourceGroups";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import { getResourceManagementClient } from "../commands/utils/arm";
import * as msGraph from "../commands/utils/graph";
import { getAuthorizationManagementClient } from "../commands/utils/arm";
import { getManagedCluster } from "../commands/utils/clusters";
import { AuthorizationManagementClient, RoleAssignment } from "@azure/arm-authorization";

const acrPullRoleDefinitionId = "7f951dda-4ed3-4680-a7ca-43fe172d538d"; // https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/containers
const azureContributorRole = "b24988ac-6180-42a0-ab88-20f7382dd24c"; // https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles

export class AutomatedDeploymentsPanel extends BasePanel<"automatedDeployments"> {
    constructor(extensionUri: vscode.Uri) {
        // Call the BasePanel constructor with the required contentId and command keys
        super(extensionUri, "automatedDeployments", {
            getGitHubReposResponse: null,
            getSubscriptionsResponse: null,
            getWorkflowCreationResponse: null,
            getResourceGroupsResponse: null,
            getAcrsResponse: null,
        });
    }
}

export class AutomatedDeploymentsDataProvider implements PanelDataProvider<"automatedDeployments"> {
    private readonly resourceManagementClient: ResourceManagementClient;
    constructor(
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly subscriptionId: string,
        readonly devHubClient: DeveloperHubServiceClient,
        readonly octokitClient: Octokit,
        readonly graphClient: GraphClient,
    ) {
        this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
    }

    getTitle(): string {
        return `Automated Deployments with DevHub`; //Title open to change
    }

    getInitialState(): InitialState<"automatedDeployments"> {
        return {
            repos: ["..."], //Will change to more useful inital state in subsequent PRs
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"automatedDeployments"> {
        return {
            getGitHubReposRequest: false,
            getSubscriptionsRequest: false,
            createWorkflowRequest: false,
            getResourceGroupsRequest: false,
            getAcrsRequest: false,
        };
    }

    getMessageHandler(
        webview: ToWebviewMessageSink<"automatedDeployments">,
    ): MessageHandler<ToVsCodeMsgDef<"automatedDeployments">> {
        return {
            getGitHubReposRequest: () => this.handleGetGitHubReposRequest(webview),
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            createWorkflowRequest: () => this.handleCreateWorkflowRequest(webview),
            getResourceGroupsRequest: () => this.handleGetResourceGroupsRequest(webview),
            getAcrsRequest: (msg) => this.handleGetAcrsRequest(msg.subscriptionId, msg.acrResourceGroup, webview),
        };
    }

    private async handleGetGitHubReposRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const repoNames = await getRepositoryNames(this.octokitClient);

        // Send the list of repositories to the webview
        webview.postGetGitHubReposResponse({ repos: repoNames });
    }

    private async handleGetSubscriptionsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscriptions = await getSubscriptions(this.sessionProvider, SelectionType.AllIfNoFilters);
        if (failed(azureSubscriptions)) {
            vscode.window.showErrorMessage(azureSubscriptions.error);
            return;
        }

        const subscriptions = azureSubscriptions.result.map((subscription) => ({
            id: subscription.subscriptionId,
            name: subscription.displayName,
        }));

        webview.postGetSubscriptionsResponse(subscriptions);
    }

    private async handleGetResourceGroupsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const groups = await getResourceGroups(this.sessionProvider, this.subscriptionId);

        if (failed(groups)) {
            vscode.window.showErrorMessage(groups.error);
            return;
        }

        const usableGroups = groups.result
            .filter(isValidResourceGroup)
            .map((g) => ({
                label: `${g.name} (${g.location})`,
                name: g.name,
                location: g.location,
            }))
            .sort((a, b) => (a.name > b.name ? 1 : -1)); //Alphabetically sort the resource groups

        webview.postGetResourceGroupsResponse(usableGroups);
    }

    private async handleGetAcrsRequest(
        subscriptionId: string,
        acrResourceGroup: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const acrResp = await acrUtils.getAcrs(this.sessionProvider, subscriptionId, acrResourceGroup);
        if (failed(acrResp)) {
            vscode.window.showErrorMessage(acrResp.error);
            return;
        }

        const acrs: AcrKey[] = acrResp.result.map((acr) => ({
            acrName: acr.name,
        }));

        webview.postGetAcrsResponse({ acrs });
    }

    private async handleCreateWorkflowRequest(webview: MessageSink<ToWebViewMsgDef>) {
        //---Hardcoded values for testing purposes, will be replaced with webview input---
        const user = "ReinierCC";
        const repo = "contoso-air";
        const branch = "main";
        const subscriptionId = "feb5b150-60fe-4441-be73-8c02a524f55a";
        const clusterResourceGroup = "rei-rg";
        const clusterName = "reiCluster";

        const acrName = "reiacr9";
        const acrResourceGroup = "rei-rg";
        const acrLocation = "eastus2";
        //------

        //---Run Neccesary Checks prior to making the call to DevHub to create a workflow ----

        //Check if new resource group must be created //TODO

        //Check for isNewNamespace, to see if new namespace must be created. //TODO

        //Create ACR if required
        //ACR will be created based off user input for naming and resource group
        const createNewAcrReq = true;
        const createNewAcrResourceGroupReq = true;
        if (createNewAcrReq) {
            const acrCreationSucceeded = await createNewAcr(
                this.sessionProvider,
                this.subscriptionId,
                acrResourceGroup,
                acrName,
                acrLocation,
                this.resourceManagementClient,
                createNewAcrResourceGroupReq,
            );
            if (!acrCreationSucceeded) {
                return;
            }
        }

        //Create a New App Registration representing the workflow
        const newApp = await msGraph.createApplication(this.graphClient, generateRandomWorkflowName());
        if (failed(newApp)) {
            console.error("Error creating new App Registration for DevHub:", newApp.error);
            return;
        }
        console.log("New App Registration created:", newApp.result);

        //Create Service Principal for App Registration (Enterprise Application)
        const newServicePrincipal = await msGraph.createServicePrincipal(this.graphClient, newApp.result.appId);
        if (failed(newServicePrincipal)) {
            console.error("Error creating new service principal for DevHub Workflow:", newServicePrincipal.error);
            return;
        }
        console.log("New Service Principal Created:", newServicePrincipal.result);

        //Add Federated Credentials for GitHub repo in App Registration
        const gitFedCredResp = await msGraph.createGitHubActionFederatedIdentityCredential(
            this.graphClient,
            newApp.result.appId,
            user,
            repo,
            branch,
        );
        if (failed(gitFedCredResp)) {
            console.error("Error creating GitHub Federated Credential:", gitFedCredResp.error);
            return;
        }
        console.log("GitHub Federated Credential created:", gitFedCredResp.result);

        const authManagmentClient = getAuthorizationManagementClient(this.sessionProvider, subscriptionId);

        //Represent ArmID for ACR and Cluster
        const acrScope = roleAssignmentsUtil.getScopeForAcr(subscriptionId, acrResourceGroup, acrName);
        const clusterScope = roleAssignmentsUtil.getScopeForCluster(subscriptionId, clusterResourceGroup, clusterName);

        //Assign Collaborator Role to Service Principal for ACR
        const acrRoleCreation = await roleAssignmentsUtil.createRoleAssignment(
            authManagmentClient,
            subscriptionId,
            newServicePrincipal.result.appId,
            azureContributorRole,
            acrScope,
            "ServicePrincipal",
        );
        if (failed(acrRoleCreation)) {
            console.error("Error creating role assignment:", acrRoleCreation.error);
            return;
        }
        console.log("Role assignment created:", acrRoleCreation.result);

        //Assign Collaborator Role to Service Principal for AKS cluster
        const clusterRoleCreation = await roleAssignmentsUtil.createRoleAssignment(
            authManagmentClient,
            subscriptionId,
            newServicePrincipal.result.appId,
            azureContributorRole,
            clusterScope,
            "ServicePrincipal",
        );
        if (failed(clusterRoleCreation)) {
            console.error("Error creating role assignment:", clusterRoleCreation.error);
            return;
        }
        console.log("Collab Role assignment created:", clusterRoleCreation.result);

        //Get Cluster Principal ID for Role Assignment Check
        const clusterPrincipalId = await getClusterPrincipalId(
            this.sessionProvider,
            subscriptionId,
            clusterResourceGroup,
            clusterName,
        );
        if (failed(clusterPrincipalId)) {
            console.error("Error getting cluster principal ID:", clusterPrincipalId.error);
            return;
        }

        //Providing Cluster ACR Pull Role
        const acrPullResp = await verifyAndAssignAcrPullRole(
            authManagmentClient,
            clusterPrincipalId.result,
            acrResourceGroup,
            acrName,
            subscriptionId,
            acrScope,
        );
        if (failed(acrPullResp)) {
            console.error("Error verifying and assigning ACR pull role:", acrPullResp.error);
            return;
        }

        //---Run Neccesary Checks prior to making the call to DevHub to create a workflow ----

        ////////////TODO: Pass in neccesary parameters for workflow creation
        const prUrl = await launchDevHubWorkflow(this.devHubClient);
        if (prUrl !== undefined) {
            vscode.window.showInformationMessage(`Workflow created successfully. PR: ${prUrl}`);
            webview.postGetWorkflowCreationResponse(prUrl);
        }
    }
}

async function getRepositoryNames(octokit: Octokit): Promise<string[]> {
    try {
        // Fetch the list of repositories for the authenticated user
        const response = await octokit.repos.listForAuthenticatedUser({});

        // Extract repository names
        const repoNames = response.data.map((repo) => repo.name);

        return repoNames;
    } catch (error) {
        console.error("Error fetching repositories:", error);
        throw error; // Re-throw the error for upstream handling
    }
}

async function createNewAcr(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    acrResourceGroup: string,
    acrName: string,
    acrLocation: string,
    resourceManagementClient: ResourceManagementClient,
    createNewAcrResourceGroupReq: boolean = false,
): Promise<boolean> {
    if (createNewAcrResourceGroupReq) {
        const resourceGroupCreation = await createNewResourceGroup(
            resourceManagementClient,
            acrResourceGroup,
            acrLocation,
        );
        if (!resourceGroupCreation.succeeded) {
            console.error(resourceGroupCreation.error);
            vscode.window.showErrorMessage(resourceGroupCreation.error);
            return false;
        }
    }

    const acrResp = await acrUtils.createAcr(sessionProvider, subscriptionId, acrResourceGroup, acrName, acrLocation);
    if (!acrResp.succeeded) {
        console.error(acrResp.error);
        vscode.window.showErrorMessage(acrResp.error);
    }
    return acrResp.succeeded;
}

//Current Manual Implementation
//This serves only as a reference of the desired goal for the required fields to acomplish workflow creation
async function launchDevHubWorkflow(devHubClient: DeveloperHubServiceClient): Promise<string | undefined> {
    const subscriptionId = "feb5b150-60fe-4441-be73-8c02a524f55a";
    const clusterName = "reiCluster";
    const resourceGroup = "rei-rg";
    const clusterScope = roleAssignmentsUtil.getScopeForCluster(subscriptionId, resourceGroup, clusterName);

    const workflowName = "workflow2Rei";
    const workflowParameters: Workflow = {
        acr: {
            acrRegistryName: "reiacr9",
            acrRepositoryName: "contoso-air", //prob an issue with this repo, WHAT IS ACR REPO
            acrResourceGroup: "rei-rg",
            acrSubscriptionId: subscriptionId,
        },
        aksResourceId: clusterScope,
        appName: "my-app",
        branchName: "playground",
        deploymentProperties: {
            kubeManifestLocations: ["./manifests"],
            manifestType: "kube",
            overrides: { key1: "value1" },
        },
        dockerBuildContext: "./src/web",
        dockerfile: "./Dockerfile",
        dockerfileGenerationMode: "enabled",
        dockerfileOutputDirectory: "./",
        generationLanguage: "javascript",
        imageName: "reiacr9.azurecr.io/contoso-air",
        imageTag: "latest",
        languageVersion: "19",
        location: "eastus2",
        manifestGenerationMode: "enabled",
        manifestOutputDirectory: "./",
        manifestType: "kube",
        namespacePropertiesArtifactGenerationPropertiesNamespace: "default",
        namespacePropertiesGithubWorkflowProfileNamespace: "default",
        oidcCredentials: {
            azureClientId: "a5279966-006c-4cc1-ab27-1f99be336265", // application ID of Entra App
            azureTenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
        },
        port: "3000",
        repositoryName: "contoso-air",
        repositoryOwner: "ReinierCC",
        tags: { appname: "my-app" },
    };
    vscode.window.showInformationMessage("Creating workflow...");
    const workflowResult = await devHubClient.workflowOperations.createOrUpdate(
        "rei-rg",
        workflowName,
        workflowParameters,
    );

    if (workflowResult.prStatus === "failed") {
        vscode.window.showErrorMessage("Failed to create workflow");
        return;
    }

    return workflowResult.prURL;
}

async function createNewResourceGroup(
    resourceManagementClient: ResourceManagementClient,
    resourceGroupName: string,
    location: string,
): Promise<Errorable<void>> {
    //Frontend should already check for proper resource group naming convention
    try {
        await resourceManagementClient.resourceGroups.createOrUpdate(resourceGroupName, {
            location,
        });

        return { succeeded: true, result: undefined };
    } catch (error) {
        console.error(`Error creating new resource group ${resourceGroupName}:`, error);
        vscode.window.showErrorMessage(String(error));
        return { succeeded: false, error: String(error) };
    }
}

function isValidResourceGroup(group: ARMResourceGroup): group is ResourceGroup {
    if (!group.name || !group.id) return false;
    if (group.name?.startsWith("MC_")) return false;

    return true;
}

function generateRandomWorkflowName(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let randomString = "";
    for (let i = 0; i < 16; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        randomString += chars[randomIndex];
    }
    return `workflow-${randomString}`;
}

//From Attach ACR to Cluster Page
//Will put inside a util file at later point. (And change usage in other parts of extension to point to util file)
async function getClusterPrincipalId(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<string>> {
    // This is adapted from the Azure CLI implementation of `az aks update --attach-acr`.
    const cluster = await getManagedCluster(sessionProvider, subscriptionId, resourceGroup, clusterName);
    if (failed(cluster)) {
        return cluster;
    }

    // See: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/_helpers.py#L79-L88
    const hasManagedIdentity =
        cluster.result.identity?.type === "SystemAssigned" || cluster.result.identity?.type === "UserAssigned";
    if (hasManagedIdentity) {
        // For the case where the cluster _has_ a managed identity, use `objectId` from the `kubeletidentity` profile.
        // see: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/managed_cluster_decorator.py#L6808-L6815
        if (
            cluster.result.identityProfile &&
            "kubeletidentity" in cluster.result.identityProfile &&
            cluster.result.identityProfile.kubeletidentity.objectId
        ) {
            return {
                succeeded: true,
                result: cluster.result.identityProfile.kubeletidentity.objectId,
            };
        }

        return {
            succeeded: false,
            error: "Cluster has managed identity but no kubelet identity",
        };
    }

    // Fall back to the `clientId` property of the service principal profile
    // for the case where the cluster has no managed identity:
    // See: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/managed_cluster_decorator.py#L5787-L5795
    const servicePrincipalId = cluster.result.servicePrincipalProfile?.clientId;
    if (servicePrincipalId) {
        return {
            succeeded: true,
            result: servicePrincipalId,
        };
    }

    return {
        succeeded: false,
        error: "Cluster has no managed identity or service principal",
    };
}

async function verifyAndAssignAcrPullRole(
    authManagmentClient: AuthorizationManagementClient,
    clusterPrincipalId: string,
    acrResourceGroup: string,
    acrName: string,
    subscriptionId: string,
    acrScope: string,
): Promise<Errorable<Promise<void>>> {
    //Check for all role assignments for ACR
    const acrRoleAssignmentsResult = await roleAssignmentsUtil.getPrincipalRoleAssignmentsForAcr(
        authManagmentClient,
        clusterPrincipalId,
        acrResourceGroup,
        acrName,
    );
    if (failed(acrRoleAssignmentsResult)) {
        console.error("Error getting ACR role assignments:", acrRoleAssignmentsResult.error);
        return { succeeded: false, error: acrRoleAssignmentsResult.error };
    }

    const hasAcrPull = acrRoleAssignmentsResult.result.some(isAcrPull);

    if (!hasAcrPull) {
        const acrPull = await roleAssignmentsUtil.createRoleAssignment(
            authManagmentClient,
            subscriptionId,
            clusterPrincipalId,
            acrPullRoleDefinitionId,
            acrScope,
        );
        if (failed(acrPull)) {
            console.error("Error creating role ACR Pull role assignment:", acrPull.error);
            return { succeeded: false, error: acrPull.error };
        }
    }
    return { succeeded: true, result: Promise.resolve() };
}

//From Attach ACR to Cluster Page
function isAcrPull(roleAssignment: RoleAssignment): boolean {
    if (!roleAssignment.roleDefinitionId) {
        return false;
    }

    const roleDefinitionName = roleAssignment.roleDefinitionId.split("/").pop();
    return roleDefinitionName === acrPullRoleDefinitionId;
}
