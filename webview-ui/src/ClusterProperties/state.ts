import { ClusterInfo, InitialState } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { Lazy, newLoaded, newLoading, newNotLoaded } from "../utilities/lazy";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type CreateClusterState = InitialState & {
    clusterInfo: Lazy<ClusterInfo>;
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
        clusterOperationRequested: false,
        errorMessage: null,
        selectedUpgradeVersion: null,
    }),
    vscodeMessageHandler: {
        getPropertiesResponse: (state, clusterInfo) => ({
            ...state,
            clusterInfo: newLoaded(clusterInfo),
            clusterOperationRequested: false,
        }),
        upgradeClusterVersionResponse: (state) => ({
            ...state,
            clusterOperationRequested: false,
        }),
        errorNotification: (state, err) => ({ ...state, errorMessage: err }),
    },
    eventHandler: {
        setPropertiesLoading: (state) => ({ ...state, clusterInfo: newLoading() }),
        setClusterOperationRequested: (state) => ({ ...state, clusterOperationRequested: true }),
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
});
