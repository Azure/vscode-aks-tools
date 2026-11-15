import { ClusterInfo, InitialState } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { isLoaded, Lazy, newLoaded, newLoading, newNotLoaded } from "../utilities/lazy";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type CreateClusterState = InitialState & {
    clusterInfo: Lazy<ClusterInfo>;
    propertiesLoading: boolean;
    clusterOperationRequested: boolean;
    errorMessage: string | null;
    selectedUpgradeVersion: string | null;
};

export type EventDef = {
    setPropertiesLoading: void;
    setClusterOperationRequested: void;
    upgradeVersionSelected: string;
};

export const stateUpdater: WebviewStateUpdater<"clusterProperties", EventDef, CreateClusterState> = {
    createState: (initialState) => ({
        ...initialState,
        clusterInfo: newNotLoaded(),
        propertiesLoading: false,
        clusterOperationRequested: false,
        errorMessage: null,
        selectedUpgradeVersion: null,
    }),
    vscodeMessageHandler: {
        getPropertiesResponse: (state, clusterInfo) => ({
            ...state,
            clusterInfo: newLoaded(clusterInfo),
        }),
        propertiesRequestComplete: (state) => ({
            ...state,
            propertiesLoading: false,
        }),
        clusterOperationResponse: (state) => ({
            ...state,
            clusterOperationRequested: false,
        }),
        upgradeClusterVersionResponse: (state) => ({
            ...state,
            selectedUpgradeVersion: null,
        }),
        errorNotification: (state, err) => ({
            ...state,
            errorMessage: state.errorMessage && state.errorMessage !== err ? `${state.errorMessage}\n${err}` : err,
        }),
    },
    eventHandler: {
        setPropertiesLoading: (state) => ({
            ...state,
            clusterInfo: isLoaded(state.clusterInfo) ? state.clusterInfo : newLoading(),
            propertiesLoading: true,
            errorMessage: null,
        }),
        setClusterOperationRequested: (state) => ({
            ...state,
            clusterOperationRequested: true,
            errorMessage: null,
        }),
        upgradeVersionSelected: (state, version) => ({ ...state, selectedUpgradeVersion: version }),
    },
};

export const vscode = getWebviewMessageContext<"clusterProperties">({
    getPropertiesRequest: null,
    stopClusterRequest: null,
    startClusterRequest: null,
    abortAgentPoolOperation: null,
    abortClusterOperation: null,
    reconcileClusterRequest: null,
    refreshRequest: null,
    upgradeClusterVersionRequest: null,
    detectorCRUDRequest: null,
});
