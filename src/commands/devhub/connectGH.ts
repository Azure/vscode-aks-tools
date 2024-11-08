import {
    Workflow,
    GitHubOAuthCallRequest,
    GitHubOAuthOptionalParams,
    DeveloperHubServiceClient,
    ArtifactGenerationProperties,
} from "@azure/arm-devhub";
//import { DefaultAzureCredential, DefaultAzureCredentialOptions, InteractiveBrowserCredential } from "@azure/identity";
import * as dotenv from "dotenv";
//import * as k8s from "vscode-kubernetes-tools-api";
//import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { getExtension } from "../utils/host";
import { getReadySessionProvider, getCredential } from "../../auth/azureAuth";
import * as vscode from "vscode";
import { failed, Errorable, getErrorMessage } from "../utils/errorable";
//import { AuthenticationProvider, Client } from "@microsoft/microsoft-graph-client";
import { setLogLevel } from "@azure/logger";
import * as msGraph from "../utils/graph";
import * as gitHubUtils from "../utils/gitHub";
import * as acrUtils from "../utils/acrs";
import * as roleAssignmentsUtil from "../utils/roleAssignments";
import { getAuthorizationManagementClient } from "../utils/arm";

setLogLevel("info");

import open from "open"; // open the browser if needed
import { Octokit } from "@octokit/rest";
import { getAcrManagementClient } from "../utils/arm";
//import { create } from "domain";

export type ApplicationParams = {
    displayName: string;
};
export type Application = ApplicationParams & {
    appId: string;
    id: string;
};

export default async function ConnectGitHubDevHub() {
    //const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    // const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);
    // if (failed(subscriptionNode)) {
    //     vscode.window.showErrorMessage(subscriptionNode.error);
    //     return;
    // }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const credential = getCredential(sessionProvider.result);

    console.log("Starting GitHub OAuth flow using Developer Hub...");

    const subscriptionId = "feb5b150-60fe-4441-be73-8c02a524f55a"; //AKS Standalone 1
    const location = "eastus2"; // Azure region where DevHub is deployed

    // GitHub OAuth request via DevHub
    const parameters: GitHubOAuthCallRequest = {
        // Got when manually trying to auth with devhub
        //redirectUrl:
        //    "https://learn.microsoft.com/en-us/azure/aks/aks-extension-draft-github-workflow?tabs=command-palette",
    };
    const options: GitHubOAuthOptionalParams = { parameters };

    // Find available azure credentials
    //const credential = new DefaultAzureCredential();
    const devHubClient = new DeveloperHubServiceClient(credential, subscriptionId);

    let result;
    try {
        //Initiate the OAuth flow via DevHub
        result = await devHubClient.gitHubOAuth(location, options);

        const authLink: string = result.authURL!;

        //const auth = await open(authLink); //opens user default browser

        //await delay(10000);

        if (result && result.token) {
            console.log("GitHub OAuth succeeded. Token received:", result.token);
        } else {
            console.log("GitHub OAuth did not return a valid token.");
        }
    } catch (error) {
        console.error("Error during GitHub OAuth process:", error);
    }

    // const appParameters: ArtifactGenerationProperties = {
    //     appName: "my-app",
    //     dockerfileGenerationMode: "enabled",
    //     dockerfileOutputDirectory: "./",
    //     generationLanguage: "javascript",
    //     imageName: "myimage",
    //     imageTag: "latest",
    //     languageVersion: "14",
    //     manifestGenerationMode: "enabled",
    //     manifestOutputDirectory: "./",
    //     manifestType: "kube",
    //     namespace: "my-namespace",
    //     port: "80",
    // };

    // const result = await devHubClient.generatePreviewArtifacts(location, appParameters);
    // console.log("Generate Preview Artifacts Output:", result);

    //Get Microsoft Graph Client
    const graphClient = msGraph.createGraphClient(sessionProvider.result);

    //Print out owned applications
    //const ownedApps = await msGraph.getOwnedApplications(graphClient);
    //console.log("Owned Applications:", ownedApps);

    //Create a new application//////////////////////////////////////////////////
    // const newApp = await msGraph.createApplication(graphClient, "FedCredTestApp");
    // if (failed(newApp)) {
    //     console.error("Error creating new application:", newApp.error);
    //     return;
    // }
    // console.log("New Application created:", newApp.result);

    const appId = "a5279966-006c-4cc1-ab27-1f99be336265";
    //const id = "113500b2-1a60-41c7-bcf4-c51c91629e4e";
    //Delete an application/////////////////////////////////////////////////////////////////////////////
    // const deleteApp = await msGraph.deleteApplication(graphClient, newApp.result.id);
    // if (failed(deleteApp)) {
    //     console.error("Error creating new application:", deleteApp.error);
    //     return;
    // }
    // console.log("Application deleted:", deleteApp.result);

    //Create a new service principal (Enterprise Application)////////////////////////////////////////////
    // const newServicePrincipal = await msGraph.createServicePrincipal(graphClient, newApp.result.appId);
    // if (failed(newServicePrincipal)) {
    //     console.error("Error creating new service principal:", newServicePrincipal.error);
    //     return;
    // }
    // console.log("New Service Principal created:", newServicePrincipal.result);

    const appServicePrincipalId = "f23ea416-1fa8-408d-b207-332acbc93833";

    //Accessing Github with Octokit
    const gitToken = result ? result.token : "";

    console.log("GitHub OAuth token:", gitToken);

    //Output available github repos/////////////////////////////////
    // const repos = await devHubClient.gitHubOAuth
    const octokit = new Octokit({
        auth: gitToken, // Use the token received from GitHub OAuth
    });

    try {
        const repos = await octokit.repos.listForAuthenticatedUser();
        console.log("GitHub Repositories:", repos.data);
    } catch (error) {
        console.error("Error fetching GitHub repositories:", error);
    }

    //Output available branches for selected github repo/////////////////////////////////
    try {
        const contoso = await octokit.repos.listBranches({
            owner: "ReinierCC",
            repo: "contoso-air",
        });
        console.log("Contoso Air Example:", contoso.data);
    } catch (error) {
        console.error("Error fetching contoso-air repo:", error);
    }

    //Put federated credential secrets in the github repo/////////////////////////////////
    //To place secret in GitHub it must be encryped: https://docs.github.com/en/rest/guides/encrypting-secrets-for-the-rest-api?apiVersion=2022-11-28

    //Need to grab the public key of the repository

    const pubKey = await octokit.actions.getRepoPublicKey({
        owner: "ReinierCC",
        repo: "contoso-air",
    });

    console.log("Public Key:", pubKey.data.key);

    // Manually provide the repo name
    const owner = "ReinierCC";
    const repo = "contoso-air";

    // const secretCreation = await gitHubUtils.createGitHubSecret(
    //     octokit,
    //     owner,
    //     repo,
    //     pubKey.data,
    //     "reis_deepest_darkest_secret",
    //     "test",
    // );
    // if (failed(secretCreation)) {
    //     console.error("Error creating GitHub secret:", secretCreation.error);
    // } else {
    //     console.log("GitHub Secret created");
    // }

    //Create federated crediential secret in the application registration/////////////////////////////////
    // const fedCredResp = await msGraph.createFederatedIdentityCredential(
    //     graphClient,
    //     appId,
    //     "subject_name",
    //     "test_name",
    //     "test_description",
    // );
    // if (failed(fedCredResp)) {
    //     console.error("Error creating federated credential:", fedCredResp.error);
    // } else {
    //     console.log("Federated Credential created:", fedCredResp.result);
    // }

    // const gitFedCredResp = await msGraph.createGitHubActionFederatedIdentityCredential(
    //     graphClient,
    //     appId,
    //     "ReinierCC",
    //     "contoso-air",
    //     "main",
    // );
    // if (failed(gitFedCredResp)) {
    //     console.error("Error creating GitHub federated credential:", gitFedCredResp.error);
    // } else {
    //     console.log("GitHub Federated Credential created:", gitFedCredResp.result);
    // }

    //Create a new ACR//////////////////////////////////////////////////////////////////////////////
    const acrName = "reiacr9"; //TODO: proper name input checking on the frontend
    const acrResourceGroup = "rei-rg"; //TODO: check for resoruce group existence, and if not create. similar to create a cluster page
    const acrLocation = "eastus2";

    // const acrResp = await acrUtils.createAcr(
    //     sessionProvider.result,
    //     subscriptionId,
    //     acrResourceGroup,
    //     acrName,
    //     acrLocation,
    // );
    // if (failed(acrResp)) {
    //     console.error("Error creating ACR:", acrResp.error);
    // } else {
    //     console.log("ACR created:", acrResp.result);
    // }

    //Delete ACR///////////////////////////////////////////////////////////////////////////////////
    // const acrDeleteResp = await acrUtils.deleteAcr(sessionProvider.result, subscriptionId, acrResourceGroup, acrName);
    // if (failed(acrDeleteResp)) {
    //     console.error("Error deleting ACR:", acrDeleteResp.error);
    // } else {
    //     console.log("ACR deleted");
    // }

    const scope = roleAssignmentsUtil.getScopeForAcr(subscriptionId, acrResourceGroup, acrName);
    console.log("ACR Scope:", scope);

    const authManagmentClient = getAuthorizationManagementClient(sessionProvider.result, subscriptionId);

    //Gets role assignments of the application registration
    // const roleAssignments = await roleAssignmentsUtil.getPrincipalRoleAssignmentsForAcr(
    //     authManagmentClient,
    //     appId,
    //     acrResourceGroup,
    //     acrName,
    // );
    // console.log("ACR Role Assignments:", roleAssignments);

    //Create contributor role assignment for service principal representing the app registration in the ACR
    //doc for contributor role: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
    const azureContributorRole = "b24988ac-6180-42a0-ab88-20f7382dd24c";

    // const roleCreation = await roleAssignmentsUtil.createRoleAssignment(
    //     authManagmentClient,
    //     subscriptionId,
    //     appServicePrincipalId,
    //     azureContributorRole,
    //     "ServicePrincipal",
    //     scope,
    // );
    // if (failed(roleCreation)) {
    //     console.error("Error creating role assignment:", roleCreation.error);
    // } else {
    //     console.log("Role assignment created:", roleCreation.result);
    // }
}

//Function to create application registration

// const myUserId = await msGraph.getCurrentUserId(graphClient);
// if (failed(myUserId)) {
//     console.error("Error getting current user ID:", myUserId.error);
//     return;
// }

// console.log("My User ID:", myUserId);
