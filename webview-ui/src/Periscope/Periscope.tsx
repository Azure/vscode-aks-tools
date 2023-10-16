import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { useEffect } from "react";
import { InitialState, NodeUploadStatus, PodLogs } from "../../../src/webview-contract/webviewDefinitions/periscope";
import { getWebviewMessageContext } from "../utilities/vscode";
import { ErrorView } from "./ErrorView";
import { NoDiagnosticSettingView } from "./NoDiagnosticSettingView";
import { SuccessView } from "./SuccessView";
import { WebviewStateUpdater, getStateManagement } from "../utilities/state";

type PeriscopeState = InitialState & {
    nodeUploadStatuses: NodeUploadStatus[],
    selectedNode: string,
    nodePodLogs: PodLogs[] | null
};

type EventDef = {
    setSelectedNode: string
};

const stateUpdater: WebviewStateUpdater<"periscope", EventDef, PeriscopeState> = {
    createState: initialState => ({
        ...initialState,
        nodeUploadStatuses: initialState.nodes.map(n => ({ nodeName: n, isUploaded: false })),
        selectedNode: "",
        nodePodLogs: null
    }),
    vscodeMessageHandler: {
        nodeLogsResponse: (state, args) => ({...state, nodePodLogs: args.logs}),
        uploadStatusResponse: (state, args) => ({...state, nodeUploadStatuses: args.uploadStatuses})
    },
    eventHandler: {
        setSelectedNode: (state, node) => ({...state, selectedNode: node, nodePodLogs: null})
    }
};

export function Periscope(initialState: InitialState) {
    const vscode = getWebviewMessageContext<"periscope">();
    const {state, eventHandlers, vsCodeMessageHandlers} = getStateManagement(stateUpdater, initialState);

    useEffect(() => {
        vscode.subscribeToMessages(vsCodeMessageHandlers);
        sendUploadStatusRequest();
    }, []); // Empty list of dependencies to run only once: https://react.dev/reference/react/useEffect#useeffect

    function sendUploadStatusRequest() {
        vscode.postMessage({ command: "uploadStatusRequest", parameters: undefined });
    }

    function handleNodeClick(node: string) {
        eventHandlers.onSetSelectedNode(node);
        vscode.postMessage({ command: "nodeLogsRequest", parameters: {nodeName: node} });
    }

    return (
        <>
            <h2>AKS Periscope</h2>
            <p>
                AKS Periscope collects and exports node and pod logs into an Azure Blob storage account
                to help you analyse and identify potential problems or easily share the information
                during the troubleshooting process.
                <VSCodeLink href="https://aka.ms/vscode-aks-periscope">&nbsp;Learn more</VSCodeLink>
            </p>
            <VSCodeDivider />
            {
                {
                    error: <ErrorView clusterName={state.clusterName} message={state.message} config={state.kustomizeConfig!} />,
                    noDiagnosticsConfigured: <NoDiagnosticSettingView clusterName={state.clusterName} />,
                    success: (
                        <SuccessView
                            runId={state.runId}
                            clusterName={state.clusterName}
                            uploadStatuses={state.nodeUploadStatuses}
                            onRequestUploadStatusCheck={sendUploadStatusRequest}
                            onNodeClick={handleNodeClick}
                            selectedNode={state.selectedNode}
                            nodePodLogs={state.nodePodLogs}
                            containerUrl={state.blobContainerUrl}
                            shareableSas={state.shareableSas}
                        />)
                }[state.state]
            }
        </>
    )
}
