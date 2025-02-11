import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";
import { Validatable, unset, valid } from "../utilities/validation";
import { NewOrExisting, Subscription } from "../../../src/webview-contract/webviewDefinitions/draft/types";
import { AcrKey } from "../../../src/webview-contract/webviewDefinitions/automatedDeployments";
import { DefinedResourceGroup } from "../../../src/commands/utils/resourceGroups";

export type EventDef = {
    //Defines the events that can originate from the webview and be sent to the backend (ToVsCodeMsgDef).
    getGitHubReposRequest: void;

    // Setting selected values
    setSelectedWorkflowName: Validatable<string>;
    setSelectedGitHubRepo: Validatable<string>; //Might need to specify type more than string
    setSelectedSubscription: Validatable<Subscription>;
    setSelectedAcrResourceGroup: { resourceGroup: Validatable<string>; createNewAcrResourceGroupReq: boolean };
    setSelectedAcr: { acr: Validatable<AcrKey>; createNewAcrReq: boolean };
    setSelectedNamespace: Validatable<NewOrExisting<string>>;

    //Resource Group Creation
    setIsNewResourceGroupDialogShown: boolean;
    setNewResourceGroupName: Validatable<string>;
};

export type AutomatedDeploymentsState = {
    status: Status;

    repos: string[];

    //Reference Data
    //azureReferenceData: AzureReferenceData;
    resourceGroups: Validatable<DefinedResourceGroup[]>;
    subscriptions: Validatable<Subscription[]>;
    acrs: Validatable<AcrKey[]>;

    // Properties waiting to be automatically selected when data is available
    //pendingSelection: InitialSelection;

    //Selected Items
    selectedWorkflowName: Validatable<string>;
    selectedGitHubRepo: Validatable<string>; //Before was GitHubRepo, in workflow state
    selectedSubscription: Validatable<Subscription>;
    selectedAcrResourceGroup: Validatable<string>;
    selectedAcr: Validatable<AcrKey>;
    selectedDeploymentNamespace: Validatable<NewOrExisting<string>>;

    //Creation Flags
    createNewAcrReq: boolean;
    createNewAcrResourceGroupReq: boolean;

    //Creating new resource group
    isNewResourceGroupDialogShown: boolean;
    newResourceGroupName: Validatable<string>;

    //After PR Creation
    prUrl: Validatable<string>;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"automatedDeployments", EventDef, AutomatedDeploymentsState> = {
    createState: (initialState) => ({
        //Initalize all the values in AutomatedDeploymentsState
        status: "Editing",

        repos: initialState.repos,

        resourceGroups: unset(),
        subscriptions: unset(),
        acrs: unset(),

        //Selected Items
        selectedWorkflowName: unset(),
        selectedGitHubRepo: unset(),
        selectedSubscription: unset(),
        selectedAcrResourceGroup: unset(),
        selectedAcr: unset(),
        selectedDeploymentNamespace: unset(),

        //Creation Flags
        createNewAcrReq: false,
        createNewAcrResourceGroupReq: false,

        //Creating new resource group
        isNewResourceGroupDialogShown: false,
        newResourceGroupName: unset(),

        //After PR Creation
        prUrl: unset(),
    }),
    vscodeMessageHandler: {
        // This handler updates the state when a message from the extension
        getGitHubReposResponse: (state, msg) => ({
            ...state,
            repos: msg.repos,
        }),
        getSubscriptionsResponse: (state, subs) => ({
            ...state,
            subscriptions: valid(subs),
        }),
        getResourceGroupsResponse: (state, groups) => ({
            ...state,
            resourceGroups: valid(groups),
        }),
        getAcrsResponse: (state, msg) => ({
            ...state,
            acrs: valid(msg.acrs),
        }),
        getWorkflowCreationResponse: (state, prUrl) => ({
            ...state,
            prUrl: valid(prUrl),
            status: "Created", //Requires check for proper creation
        }),
    },
    eventHandler: {
        //These are events that occur inside the webview
        getGitHubReposRequest: (state) => ({
            ...state,
        }),
        setSelectedWorkflowName: (state, name) => ({
            ...state,
            selectedWorkflowName: name,
        }),
        setSelectedGitHubRepo: (state, repo) => ({
            ...state,
            selectedGitHubRepo: repo,
        }),
        setSelectedSubscription: (state, subscription) => ({
            ...state,
            selectedSubscription: subscription,
        }),
        setIsNewResourceGroupDialogShown: (state, isShown) => ({
            ...state,
            isNewResourceGroupDialogShown: isShown,
        }),
        setNewResourceGroupName: (state, name) => ({
            ...state,
            newResourceGroupName: name,
        }),
        setSelectedNamespace: (state, namespace) => ({
            ...state,
            selectedDeploymentNamespace: namespace,
        }),
        setSelectedAcrResourceGroup: (
            state,
            msg: { resourceGroup: Validatable<string>; createNewAcrResourceGroupReq: boolean },
        ) => ({
            ...state,
            selectedAcrResourceGroup: msg.resourceGroup,
            createNewAcrResourceGroupReq: msg.createNewAcrResourceGroupReq,
        }),
        setSelectedAcr: (state, msg: { acr: Validatable<AcrKey>; createNewAcrReq: boolean }) => ({
            ...state,
            selectedAcr: msg.acr,
            createNewAcrReq: msg.createNewAcrReq,
        }),
    },
};

export const vscode = getWebviewMessageContext<"automatedDeployments">({
    getGitHubReposRequest: null,
    getSubscriptionsRequest: null,
    createWorkflowRequest: null,
    getResourceGroupsRequest: null,
    getAcrsRequest: null,
});
