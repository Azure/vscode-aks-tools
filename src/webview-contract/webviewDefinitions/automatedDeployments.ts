import { DefinedResourceGroup } from "../../commands/utils/resourceGroups";
import { WebviewDefinition } from "../webviewTypes";
import { Subscription } from "./draft/types";

// Define the initial state passed to the webview
export interface InitialState {
    repos: string[];
}

export type InitialSelection = {
    subscriptionId?: string;
};

export interface ResourceGroup {
    name: string;
    location: string;
}

export type AcrKey = {
    acrName: string;
};

// Define messages sent from the webview to the VS Code extension
export type ToVsCodeMsgDef = {
    getGitHubReposRequest: void;
    getSubscriptionsRequest: void;
    createWorkflowRequest: void;
    getResourceGroupsRequest: void;
    getAcrsRequest: { subscriptionId: string; acrResourceGroup: string };
};

// Define messages sent from the VS Code extension to the webview
export type ToWebViewMsgDef = {
    getGitHubReposResponse: { repos: string[] };
    getSubscriptionsResponse: Subscription[];
    getResourceGroupsResponse: DefinedResourceGroup[];
    getAcrsResponse: { acrs: AcrKey[] };
    getWorkflowCreationResponse: string;
};

// Combine the definitions into a single WebviewDefinition
export type AutomatedDeploymentsDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
