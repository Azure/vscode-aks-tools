import { InitialState } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import styles from "./TcpDump.module.css";
import React, { useEffect } from "react";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { getStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";

export function TcpDump(initialState: InitialState) {
    const {state, eventHandlers, vsCodeMessageHandlers} = getStateManagement(stateUpdater, initialState);

    // TODO: Put in state
    const localcapfile=`/tmp/localuniquename.cap`;

    useEffect(() => {
        vscode.subscribeToMessages(vsCodeMessageHandlers);
    });

    function handleCreateDebugPod(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();
        vscode.postStartDebugPod({
            node: state.selectedNode!
        });
    }

    function handleStartCapture(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();
        vscode.postStartTcpDump({
            node: state.selectedNode!
        });
    }

    function handleStopCapture(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();

        vscode.postEndTcpDump({
            node: state.selectedNode!
        });
    }

    function handleDownloadCaptureFile(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();
        vscode.postDownloadCaptureFile({
            node: state.selectedNode!,
            localcapfile: localcapfile
        });
    }

    function handleSelectChange(event: React.ChangeEvent<HTMLSelectElement>) {
        state.selectedNode = event.target.value;
    }

    return (
        <div className={styles.wrapper}>
            <header className={styles.mainHeading}>
                <h2>TCP Dump from Linux Node {state.clusterName}</h2>
                <VSCodeDivider />
            </header>
            <label htmlFor="nodes">Choose a Node for tcpdump:</label>

            <select name="nodes1" id="nodes1" onChange={handleSelectChange} >
                {state.allNodes.map((nodename) => (
                    <option key={nodename} value={nodename}>{nodename}</option>
                ))}
            </select> <br/>
            <a href="" onClick={handleCreateDebugPod}>Create Debug Pod</a> <br/>
            <a href="" onClick={handleStartCapture}>Play</a> <br/>
            <a href="" onClick={handleStopCapture}>Stop</a> <br/>
            <a href="" onClick={handleDownloadCaptureFile}>Download</a> <br/>
        </div>
    );;
}