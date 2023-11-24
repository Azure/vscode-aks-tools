import { InitialState, NodeUploadStatus, PodLogs } from "../../../src/webview-contract/webviewDefinitions/periscope";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type PeriscopeState = InitialState & {
    nodeUploadStatuses: NodeUploadStatus[];
    selectedNode: string;
    nodePodLogs: PodLogs[] | null;
};

export type EventDef = {
    setSelectedNode: string;
};

export const stateUpdater: WebviewStateUpdater<"periscope", EventDef, PeriscopeState> = {
    createState: (initialState) => ({
        ...initialState,
        nodeUploadStatuses: initialState.nodes.map((n) => ({ nodeName: n, isUploaded: false })),
        selectedNode: "",
        nodePodLogs: null,
    }),
    vscodeMessageHandler: {
        nodeLogsResponse: (state, args) => ({ ...state, nodePodLogs: args.logs }),
        uploadStatusResponse: (state, args) => ({ ...state, nodeUploadStatuses: args.uploadStatuses }),
    },
    eventHandler: {
        setSelectedNode: (state, node) => ({ ...state, selectedNode: node, nodePodLogs: null }),
    },
};

export const vscode = getWebviewMessageContext<"periscope">({
    nodeLogsRequest: null,
    uploadStatusRequest: null,
});
