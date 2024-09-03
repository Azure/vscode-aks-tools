import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/periscope";
import { ErrorView } from "./ErrorView";
import { NoDiagnosticSettingView } from "./NoDiagnosticSettingView";
import { SuccessView } from "./SuccessView";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";

export function Periscope(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        sendUploadStatusRequest();
    });

    function sendUploadStatusRequest() {
        vscode.postUploadStatusRequest();
    }

    function handleNodeClick(node: string) {
        eventHandlers.onSetSelectedNode(node);
        vscode.postNodeLogsRequest({ nodeName: node });
    }

    return (
        <>
            <h2>AKS Periscope</h2>
            <p>
                AKS Periscope collects and exports node and pod logs into an Azure Blob storage account to help you
                analyse and identify potential problems or easily share the information during the troubleshooting
                process.
                <VSCodeLink href="https://azure.github.io/vscode-aks-tools/features/aks-periscope.html">
                    &nbsp;Learn more
                </VSCodeLink>
            </p>
            <VSCodeDivider />
            {
                {
                    error: (
                        <ErrorView
                            clusterName={state.clusterName}
                            message={state.message}
                            config={state.kustomizeConfig!}
                        />
                    ),
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
                        />
                    ),
                }[state.state]
            }
        </>
    );
}
