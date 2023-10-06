import { CreateClusterParams, ProgressEventType, ResourceGroup, ToWebViewMsgDef } from "../../../../src/webview-contract/webviewDefinitions/createCluster";
import { StateMessageHandler, chainStateUpdaters, toStateUpdater } from "../../utilities/state";
import { UserMsgDef } from "./userCommands";

export enum Stage {
    Uninitialized,
    Loading,
    CollectingInput,
    Creating,
    Failed,
    Succeeded
}

export interface CreateClusterState {
    stage: Stage
    message: string | null
    locations: string[] | null
    resourceGroups: ResourceGroup[] | null
    createParams: CreateClusterParams | null
}

export function createState(): CreateClusterState {
    return {
        stage: Stage.Uninitialized,
        message: null,
        locations: null,
        resourceGroups: null,
        createParams: null
    };
}

export const vscodeMessageHandler: StateMessageHandler<ToWebViewMsgDef, CreateClusterState> = {
    getLocationsResponse: (state, args) => ({ ...state, locations: args.locations }),
    getResourceGroupsResponse: (state, args) => ({ ...state, resourceGroups: args.groups }),
    progressUpdate: (state, args) => ({ ...state, ...getStageAndMessage(args.operationDescription, args.event, args.errorMessage) })
}

function getStageAndMessage(operationDescription: string, event: ProgressEventType, errorMessage: string | null): Pick<CreateClusterState, "stage" | "message"> {
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

export const userMessageHandler: StateMessageHandler<UserMsgDef, CreateClusterState> = {
    setInitializing: (state, _args) => ({ ...state, stage: Stage.Loading }),
    setInitialized: (state, _args) => ({ ...state, stage: Stage.CollectingInput }),
    setCreating: (state, args) => ({ ...state, createParams: args.parameters, message: "Sending create cluster request" })
}

export const updateState = chainStateUpdaters(
    toStateUpdater(vscodeMessageHandler),
    toStateUpdater(userMessageHandler));
