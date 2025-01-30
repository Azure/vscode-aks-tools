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
import { ResourceGroup as ARMResourceGroup } from "@azure/arm-resources";
import { ReadyAzureSessionProvider } from "../auth/types";
import { Octokit } from "@octokit/rest";
import { getGitHubRepos, getGitHubBranchesForRepo } from "../commands/utils/octokitHelper";
import { ToWebViewMsgDef, ResourceGroup } from "../webview-contract/webviewDefinitions/automatedDeployments";
import { SelectionType, getSubscriptions } from "../commands/utils/subscriptions";
import * as roleAssignmentsUtil from "../../src/commands/utils/roleAssignments";
import { failed } from "../commands/utils/errorable";
//import * as acrUtils from "../commands/utils/acrs";
import { getResourceGroups } from "../commands/utils/resourceGroups";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import { getClusterNamespaces, createClusterNamespace } from "../commands/utils/clusters";
import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";

export class AutomatedDeploymentsPanel extends BasePanel<"automatedDeployments"> {
    constructor(extensionUri: vscode.Uri) {
        // Call the BasePanel constructor with the required contentId and command keys
        super(extensionUri, "automatedDeployments", {
            getGitHubReposResponse: null,
            getGitHubBranchesResponse: null,
            getSubscriptionsResponse: null,
            getWorkflowCreationResponse: null,
            getResourceGroupsResponse: null,
            getNamespacesResponse: null,
        });
    }
}

export class AutomatedDeploymentsDataProvider implements PanelDataProvider<"automatedDeployments"> {
    constructor(
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly subscriptionId: string,
        readonly devHubClient: DeveloperHubServiceClient,
        readonly octokitClient: Octokit,
        readonly graphClient: GraphClient,
        readonly kubectl: APIAvailable<KubectlV1>,
    ) {}

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
            getGitHubBranchesRequest: false,
            getSubscriptionsRequest: false,
            createWorkflowRequest: false,
            getResourceGroupsRequest: false,
            getNamespacesRequest: false,
        };
    }

    getMessageHandler(
        webview: ToWebviewMessageSink<"automatedDeployments">,
    ): MessageHandler<ToVsCodeMsgDef<"automatedDeployments">> {
        return {
            getGitHubReposRequest: () => this.handleGetGitHubReposRequest(webview),
            getGitHubBranchesRequest: (args) => this.handleGetGitHubBranchesRequest(webview, args.repoOwner, args.repo),
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            createWorkflowRequest: () => this.handleCreateWorkflowRequest(webview),
            getResourceGroupsRequest: () => this.handleGetResourceGroupsRequest(webview),
            getNamespacesRequest: (key) =>
                this.handleGetNamespacesRequest(key.subscriptionId, key.resourceGroup, key.clusterName, webview),
        };
    }

    private async handleGetGitHubReposRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const reposResp = await getGitHubRepos(this.octokitClient);
        if (failed(reposResp)) {
            vscode.window.showErrorMessage(reposResp.error);
            return;
        }

        webview.postGetGitHubReposResponse({ repos: reposResp.result });
    }

    private async handleGetGitHubBranchesRequest(
        webview: MessageSink<ToWebViewMsgDef>,
        repoOwner: string,
        repo: string,
    ) {
        const branchesResp = await getGitHubBranchesForRepo(this.octokitClient, repoOwner, repo);
        if (failed(branchesResp)) {
            vscode.window.showErrorMessage(branchesResp.error);
            return;
        }

        webview.postGetGitHubBranchesResponse({ branches: branchesResp.result });
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

    private async handleGetNamespacesRequest(
        subscriptionId: string,
        resourceGroup: string,
        clusterName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const namespacesResult = await getClusterNamespaces(
            this.sessionProvider,
            this.kubectl,
            subscriptionId,
            resourceGroup,
            clusterName,
        );
        if (failed(namespacesResult)) {
            vscode.window.showErrorMessage("Error fetching namespaces: ", namespacesResult.error);
            return;
        }

        webview.postGetNamespacesResponse(namespacesResult.result);
    }

    private async handleCreateWorkflowRequest(webview: MessageSink<ToWebViewMsgDef>) {
        //---Run Neccesary Checks prior to making the call to DevHub to create a workflow ----

        //Check if new resource group must be created

        //Check for isNewNamespace, to see if new namespace must be created.
        const isNewNamespace = true; //Actual Value Provided Later PR //PlaceHolder
        if (isNewNamespace) {
            //Create New Namespace
            const subscriptionId = "feb5b150-60fe-4441-be73-8c02a524f55a"; // These values will be provided to the fuction call from the webview
            const resourceGroup = "rei-rg"; //PlaceHolder
            const clusterName = "reiCluster"; //PlaceHolder
            const namespace = "not-default"; //PlaceHolder
            const namespaceCreationResp = await createClusterNamespace(
                this.sessionProvider,
                this.kubectl,
                subscriptionId,
                resourceGroup,
                clusterName,
                namespace,
            );

            if (failed(namespaceCreationResp)) {
                console.log("Failed to create namespace: ", namespace, "Error: ", namespaceCreationResp.error);
                vscode.window.showErrorMessage(`Failed to create namespace: ${namespace}`);
                return;
            }
            vscode.window.showInformationMessage(namespaceCreationResp.result);
        }
        //Create ACR if required

        //Verify selected ACR has correct role assignments
        //If not, assign role
        //ACR Pull for Cluster

        //Create new application registration representing the workflow
        //Add Federated Credentials for GitHub repo in App Registration
        //Create Service Principal for App Registration (Enterprise Application)
        //Assign Collaborator Role to Service Principal in AKS cluster
        //Assign Collaborator Role to Service Principal in ACR

        //---Run Neccesary Checks prior to making the call to DevHub to create a workflow ----

        const prUrl = await launchDevHubWorkflow(this.devHubClient);
        if (prUrl !== undefined) {
            vscode.window.showInformationMessage(`Workflow created successfully. PR: ${prUrl}`);
        }

        if (prUrl !== undefined) {
            webview.postGetWorkflowCreationResponse(prUrl); //Will always return success boolean alongside prUrl
        }
    }
}

// async function createNewAcr(
//     sessionProvider: ReadyAzureSessionProvider,
//     subscriptionId: string,
//     acrResourceGroup: string,
//     acrName: string,
//     acrLocation: string,
// ): Promise<string> {
//     const acrResp = await acrUtils.createAcr(sessionProvider, subscriptionId, acrResourceGroup, acrName, acrLocation);
// }

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

function isValidResourceGroup(group: ARMResourceGroup): group is ResourceGroup {
    if (!group.name || !group.id) return false;
    if (group.name?.startsWith("MC_")) return false;

    return true;
}
