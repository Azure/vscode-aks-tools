import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { useEffect, useState } from "react";
import { MessageSubscriber } from "../../../src/webview-contract/messaging";
import { PeriscopeTypes } from "../../../src/webview-contract/webviewTypes";
import { getWebviewMessageContext } from "../utilities/vscode";
import { ErrorView } from "./ErrorView";
import { NoDiagnosticSettingView } from "./NoDiagnosticSettingView";
import { SuccessView } from "./SuccessView";

export function Periscope(props: PeriscopeTypes.InitialState) {
    const vscode = getWebviewMessageContext<PeriscopeTypes.ToVsCodeCommands, PeriscopeTypes.ToWebViewCommands>();

    const [nodeUploadStatuses, setNodeUploadStatuses] = useState<PeriscopeTypes.NodeUploadStatus[]>(props.nodes.map(n => ({ nodeName: n, isUploaded: false })));
    const [selectedNode, setSelectedNode] = useState<string>("");
    const [nodePodLogs, setNodePodLogs] = useState<PeriscopeTypes.PodLogs[] | null>(null);

    useEffect(() => {
        vscode.subscribeToMessages(createMessageSubscriber());
        handleRequestUploadStatusCheck();
    }, []); // Empty list of dependencies to run only once: https://react.dev/reference/react/useEffect#useeffect

    function createMessageSubscriber(): MessageSubscriber<PeriscopeTypes.ToWebViewCommands> {
        return MessageSubscriber.create<PeriscopeTypes.ToWebViewCommands>()
            .withHandler("uploadStatusResponse", handleUploadStatusResponse)
            .withHandler("nodeLogsResponse", handleNodeLogsResponse);
    }

    function handleRequestUploadStatusCheck() {
        vscode.postMessage({ command: "uploadStatusRequest" });
    }

    function handleUploadStatusResponse(message: PeriscopeTypes.UploadStatusResponse) {
        setNodeUploadStatuses(message.uploadStatuses);
    }

    function handleNodeClick(node: string) {
        setSelectedNode(node);
        setNodePodLogs(null);
        vscode.postMessage({ command: "nodeLogsRequest", nodeName: node });
    }

    function handleNodeLogsResponse(message: PeriscopeTypes.NodeLogsResponse) {
        setNodePodLogs(message.logs);
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
                    error: <ErrorView clusterName={props.clusterName} message={props.message} config={props.kustomizeConfig!} />,
                    noDiagnosticsConfigured: <NoDiagnosticSettingView clusterName={props.clusterName} />,
                    success: (
                        <SuccessView
                            runId={props.runId}
                            clusterName={props.clusterName}
                            uploadStatuses={nodeUploadStatuses}
                            onRequestUploadStatusCheck={handleRequestUploadStatusCheck}
                            onNodeClick={handleNodeClick}
                            selectedNode={selectedNode}
                            nodePodLogs={nodePodLogs}
                            containerUrl={props.blobContainerUrl}
                            shareableSas={props.shareableSas}
                        />)
                }[props.state]
            }
        </>
    )
}
