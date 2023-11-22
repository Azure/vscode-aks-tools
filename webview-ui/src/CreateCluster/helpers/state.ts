import {
    CreateClusterParams,
    InitialState,
    ProgressEventType,
    ResourceGroup,
} from "../../../../src/webview-contract/webviewDefinitions/createCluster";
import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export enum Stage {
    Uninitialized,
    Loading,
    CollectingInput,
    Creating,
    Failed,
    Succeeded,
}

export type CreateClusterState = InitialState & {
    stage: Stage;
    message: string | null;
    locations: string[] | null;
    resourceGroups: ResourceGroup[] | null;
    createParams: CreateClusterParams | null;
};

export type EventDef = {
    setInitializing: void;
    setInitialized: void;
    setCreating: {
        parameters: CreateClusterParams;
    };
};

export const stateUpdater: WebviewStateUpdater<"createCluster", EventDef, CreateClusterState> = {
    createState: (initialState) => ({
        ...initialState,
        stage: Stage.Uninitialized,
        message: null,
        locations: null,
        resourceGroups: null,
        createParams: null,
    }),
    vscodeMessageHandler: {
        getLocationsResponse: (state, args) => ({ ...state, locations: args.locations }),
        getResourceGroupsResponse: (state, args) => ({ ...state, resourceGroups: args.groups }),
        progressUpdate: (state, args) => ({
            ...state,
            ...getStageAndMessage(args.operationDescription, args.event, args.errorMessage),
        }),
    },
    eventHandler: {
        setInitializing: (state) => ({ ...state, stage: Stage.Loading }),
        setInitialized: (state) => ({ ...state, stage: Stage.CollectingInput }),
        setCreating: (state, args) => ({
            ...state,
            createParams: args.parameters,
            message: "Sending create cluster request",
        }),
    },
};

function getStageAndMessage(
    operationDescription: string,
    event: ProgressEventType,
    errorMessage: string | null,
): Pick<CreateClusterState, "stage" | "message"> {
    switch (event) {
        case ProgressEventType.InProgress:
            return { stage: Stage.Creating, message: operationDescription };
        case ProgressEventType.Cancelled:
            return { stage: Stage.Failed, message: "Operation was cancelled." };
        case ProgressEventType.Failed:
            return { stage: Stage.Failed, message: errorMessage };
        case ProgressEventType.Success:
            return { stage: Stage.Succeeded, message: null };
    }
}

export const vscode = getWebviewMessageContext<"createCluster">({
    createClusterRequest: null,
    getLocationsRequest: null,
    getResourceGroupsRequest: null,
});
