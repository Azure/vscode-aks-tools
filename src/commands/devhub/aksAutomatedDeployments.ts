import { getReadySessionProvider, getCredential } from "../../auth/azureAuth";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { failed } from "../utils/errorable";
import * as k8s from "vscode-kubernetes-tools-api";
import * as vscode from "vscode";
import { getAksClusterTreeNode, getKubernetesClusterInfo } from "../utils/clusters";
import { getExtension } from "../utils/host";
import * as msGraph from "../utils/graph";
import { AutomatedDeploymentsPanel, AutomatedDeploymentsDataProvider } from "../../panels/DevHubAutoDeployPanel";
import { GitHubOAuthCallRequest, GitHubOAuthOptionalParams, DeveloperHubServiceClient } from "@azure/arm-devhub";
import { Octokit } from "@octokit/rest";

export default async function aksAutomatedDeployments(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
    const sessionProvider = await getReadySessionProvider();

    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`Kubectl is unavailable.`);
        return;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return;
    }

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const clusterInfo = await getKubernetesClusterInfo(sessionProvider.result, target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const graphClient = msGraph.createGraphClient(sessionProvider.result);
    if (!graphClient) {
        vscode.window.showErrorMessage(`Could not create Graph client.`);
        return;
    }

    const subscriptionId = clusterNode.result.subscriptionId;
    if (!subscriptionId) {
        vscode.window.showErrorMessage(`Subscription ID is not available.`);
        return;
    }

    const location = clusterNode.result.clusterResource.location;
    if (!location) {
        vscode.window.showErrorMessage(`Cluster location is not available.`);
        return;
    }

    //DevHub Client Creation

    const credential = getCredential(sessionProvider.result);

    const devHubClient = new DeveloperHubServiceClient(credential, subscriptionId);

    // GitHub OAuth request via DevHub
    // Currently the GitHub OAuth flow is initiated everytime the command is called but simply returns the token if already authenticated
    const parameters: GitHubOAuthCallRequest = {};
    const options: GitHubOAuthOptionalParams = { parameters };

    await devHubClient.gitHubOAuth(location, options); //Call to authenticate with GitHub occurs everytime command is called, will open new browser page if not already authed

    //Current implementation relies on polling technique to check if token is available
    //TODO: Will switch to utilizing the URI handler to handle the token response from GitHub
    //Requires changes in the DevHub service to allow vscode callback url
    const gitHubToken = await checkAndAuthenticateWithGitHub(devHubClient, location, options);
    if (!gitHubToken) {
        vscode.window.showWarningMessage(`Could Not Authenticate with GitHub`);
        return;
    }

    const octokitClient = new Octokit({
        auth: gitHubToken,
    });

    const dataProvider = new AutomatedDeploymentsDataProvider(
        sessionProvider.result,
        subscriptionId,
        devHubClient,
        octokitClient,
        graphClient,
        kubectl,
    );

    const panel = new AutomatedDeploymentsPanel(extension.result.extensionUri);

    panel.show(dataProvider);
}

async function checkAndAuthenticateWithGitHub(
    client: DeveloperHubServiceClient,
    location: string,
    options: GitHubOAuthOptionalParams,
    timeout: number = 300000,
    interval: number = 5000,
): Promise<string | undefined> {
    try {
        const gitHubOAuthResp = await client.gitHubOAuth(location, options); // Call to authenticate with GitHub

        if (!gitHubOAuthResp.token) {
            // Auth flow required
            const authLink: string = gitHubOAuthResp.authURL!;
            await vscode.env.openExternal(vscode.Uri.parse(authLink));

            vscode.window.showInformationMessage(
                "GitHub authentication initiated. Please complete the process in your browser.",
            );

            // Poll for token availability
            const token = await pollForToken(client, location, options, timeout, interval);

            console.log("GitHub OAuth succeeded.");
            return token;
        } else {
            // Already authenticated
            console.log("Already authenticated with GitHub.");
            return gitHubOAuthResp.token;
        }
    } catch (error) {
        console.error("Error occurred during GitHub OAuth:", error);
        return undefined;
    }
}

// Utility function to poll for a token
async function pollForToken(
    client: DeveloperHubServiceClient,
    location: string,
    options: GitHubOAuthOptionalParams,
    timeout: number,
    interval: number,
): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        // Delay for the polling interval
        await delay(interval);

        // Call gitHubOAuth to check if the token is now available
        const resp = await client.gitHubOAuth(location, options);
        if (resp.token) {
            return resp.token; // Token is available
        }
    }

    throw new Error("Authentication timed out.");
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
