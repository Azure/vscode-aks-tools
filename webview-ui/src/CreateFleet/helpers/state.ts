import {
    CreateFleetParams,
    CreatedFleet,
    InitialState,
    ProgressEventType,
    ResourceGroup,
} from "../../../../src/webview-contract/webviewDefinitions/createFleet";
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

export type CreateFleetState = InitialState & {
    stage: Stage;
    message: string | null;
    locations: string[] | null;
    resourceGroups: ResourceGroup[] | null;
    createParams: CreateFleetParams | null;
    deploymentPortalUrl: string | null;
    createdFleet: CreatedFleet | null;
};

export type EventDef = {
    setInitializing: void;
    setInitialized: void;
    setCreating: {
        parameters: CreateFleetParams;
    };
};

export const stateUpdater: WebviewStateUpdater<"createFleet", EventDef, CreateFleetState> = {
    createState: (initialState) => ({
        ...initialState,
        stage: Stage.Uninitialized,
        message: null,
        locations: null,
        resourceGroups: null,
        createParams: null,
        deploymentPortalUrl: null,
        createdFleet: null,
    }),
    vscodeMessageHandler: {
        getLocationsResponse: (state, args) => ({ ...state, locations: args.locations }),
        getResourceGroupsResponse: (state, args) => ({ ...state, resourceGroups: args.groups }),
        progressUpdate: (state, args) => ({
            ...state,
            ...getStageAndMessage(args.operationDescription, args.event, args.errorMessage),
            deploymentPortalUrl: args.deploymentPortalUrl,
            createdFleet: args.createdFleet,
        }),
    },
    eventHandler: {
        setInitializing: (state) => ({ ...state, stage: Stage.Loading }),
        setInitialized: (state) => ({ ...state, stage: Stage.CollectingInput }),
        setCreating: (state, args) => ({
            ...state,
            createParams: args.parameters,
            message: "Sending create fleet request",
        }),
    },
};

function getStageAndMessage(
    operationDescription: string,
    event: ProgressEventType,
    errorMessage: string | null,
): Pick<CreateFleetState, "stage" | "message"> {
    switch (event) {
        case ProgressEventType.InProgress:
            return { stage: Stage.Creating, message: operationDescription };
        case ProgressEventType.Cancelled:
            return { stage: Stage.Failed, message: "Fleet Creation is cancelled" };
        case ProgressEventType.Failed:
            return { stage: Stage.Failed, message: errorMessage };
        case ProgressEventType.Success:
            return { stage: Stage.Succeeded, message: null };
    }
}

export const vscode = getWebviewMessageContext<"createFleet">({
    createFleetRequest: null,
    getLocationsRequest: null,
    getResourceGroupsRequest: null,
});
