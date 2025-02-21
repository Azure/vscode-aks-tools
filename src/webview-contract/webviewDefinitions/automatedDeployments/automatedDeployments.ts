import { DefinedResourceGroup } from "../../../commands/utils/resourceGroups";
import { WebviewDefinition } from "../../webviewTypes";
import { Subscription } from "../draft/types";
import { TreeNode } from "../../../commands/utils/octokitHelper";
import { BranchParams, ClusterKey, RepoKey, WorkflowCreationParams, AcrKey, InitialState } from "./types";

// Define messages sent from the webview to the VS Code extension
export type ToVsCodeMsgDef = {
    getGitHubReposRequest: void;
    getGitHubBranchesRequest: BranchParams;
    getSubscriptionsRequest: void;
    getResourceGroupsRequest: void;
    getAcrsRequest: { subscriptionId: string; acrResourceGroup: string };
    getNamespacesRequest: ClusterKey;
    getRepoTreeStructureRequest: RepoKey;
    createWorkflowRequest: WorkflowCreationParams;
};

// Define messages sent from the VS Code extension to the webview
export type ToWebViewMsgDef = {
    getGitHubReposResponse: { repos: string[] };
    getGitHubBranchesResponse: { branches: string[] };
    getSubscriptionsResponse: Subscription[];
    getNamespacesResponse: string[];
    getResourceGroupsResponse: DefinedResourceGroup[];
    getAcrsResponse: { acrs: AcrKey[] };
    getWorkflowCreationResponse: string;
    getRepoTreeStructureResponse: TreeNode;
};

// Combine the definitions into a single WebviewDefinition
export type AutomatedDeploymentsDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
