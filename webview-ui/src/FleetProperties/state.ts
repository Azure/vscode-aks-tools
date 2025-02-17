import { FleetInfo, InitialState } from "../../../src/webview-contract/webviewDefinitions/fleetProperties";
import { Lazy, newLoaded, newLoading, newNotLoaded } from "../utilities/lazy";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type CreateFleetState = InitialState & {
    fleetInfo: Lazy<FleetInfo>;
    fleetOperationRequested: boolean;
    errorMessage: string | null;
};

export type EventDef = {
    setPropertiesLoading: void;
    setFleetOperationRequested: void;
};

export const stateUpdater: WebviewStateUpdater<"fleetProperties", EventDef, CreateFleetState> = {
    createState: (initialState) => ({
        ...initialState,
        fleetInfo: newNotLoaded(),
        fleetOperationRequested: false,
        errorMessage: null,
    }),
    vscodeMessageHandler: {
        getPropertiesResponse: (state, fleetInfo) => ({
            ...state,
            fleetInfo: newLoaded(fleetInfo),
            fleetOperationRequested: false,
        }),
        errorNotification: (state, err) => ({ ...state, errorMessage: err }),
    },
    eventHandler: {
        setPropertiesLoading: (state) => ({ ...state, fleetInfo: newLoading() }),
        setFleetOperationRequested: (state) => ({ ...state, fleetOperationRequested: true }),
    },
};

export const vscode = getWebviewMessageContext<"fleetProperties">({
    getPropertiesRequest: null,
    refreshRequest: null,
});
