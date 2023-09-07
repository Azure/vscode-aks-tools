import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { useEffect, useState } from "react";
import { InitialState, NodeUploadStatus, PodLogs } from "../../../src/webview-contract/webviewDefinitions/periscope";
import { getWebviewMessageContext } from "../utilities/vscode";
import { ErrorView } from "./ErrorView";
import { NoDiagnosticSettingView } from "./NoDiagnosticSettingView";
import { SuccessView } from "./SuccessView";

export function Periscope(props: InitialState) {
    const vscode = getWebviewMessageContext<"periscope">();

    const [nodeUploadStatuses, setNodeUploadStatuses] = useState<NodeUploadStatus[]>(props.nodes.map(n => ({ nodeName: n, isUploaded: false })));
    const [selectedNode, setSelectedNode] = useState<string>("");
    const [nodePodLogs, setNodePodLogs] = useState<PodLogs[] | null>(null);

    useEffect(() => {
        vscode.subscribeToMessages({
            nodeLogsResponse: args => handleNodeLogsResponse(args.logs),
            uploadStatusResponse: args => handleUploadStatusResponse(args.uploadStatuses)
        });
        handleRequestUploadStatusCheck();
    }, []); // Empty list of dependencies to run only once: https://react.dev/reference/react/useEffect#useeffect

    function handleRequestUploadStatusCheck() {
        vscode.postMessage({ command: "uploadStatusRequest", parameters: undefined });
    }

    function handleUploadStatusResponse(uploadStatuses: NodeUploadStatus[]) {
        setNodeUploadStatuses(uploadStatuses);
    }

    function handleNodeClick(node: string) {
        setSelectedNode(node);
        setNodePodLogs(null);
        vscode.postMessage({ command: "nodeLogsRequest", parameters: {nodeName: node} });
    }

    function handleNodeLogsResponse(logs: PodLogs[]) {
        setNodePodLogs(logs);
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
