import { InitialState, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import styles from "./TcpDump.module.css";
import { getWebviewMessageContext } from "../utilities/vscode";
import React, { useEffect, useReducer } from "react";
import { StateMessageHandler, chainStateUpdaters, getEventHandlers, getMessageHandler, toStateUpdater } from "../utilities/state";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import * as vscodefoo from 'vscode';

type UserMsgDef = {};

interface TcpDumpState {
    selectedNode: string
}

function createState(): TcpDumpState {
    return {
        selectedNode: "test-node"
    };
}

export const vscodeMessageHandler: StateMessageHandler<ToWebViewMsgDef, TcpDumpState> = {
    runCommandResponse: (state, args) => ({...state})
}

export const userMessageHandler: StateMessageHandler<UserMsgDef, TcpDumpState> = {
};

export const updateState = chainStateUpdaters(
    toStateUpdater(vscodeMessageHandler),
    toStateUpdater(userMessageHandler));


export function TcpDump(props: InitialState) {
    const vscode = getWebviewMessageContext<"tcpDump">();
    const localcapfile=`/tmp/localuniquename.cap`;
    const [state, dispatch] = useReducer(updateState, createState());

    useEffect(() => {
        const msgHandler = getMessageHandler<ToWebViewMsgDef>(dispatch, vscodeMessageHandler);
        vscode.subscribeToMessages(msgHandler);
    });

    const userMessageEventHandlers = getEventHandlers<UserMsgDef>(dispatch, userMessageHandler);

    function handleCreateDebugPod(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();
        vscode.postMessage({
            command: "startDebugPod", parameters: {
                node: state.selectedNode
            }
        })
    }

    function handleStartCapture(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();

        vscode.postMessage({
            command: "startTcpDump",
            parameters: {
                node: state.selectedNode
            }
        })
    }

    function handleStopCapture(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();

        vscode.postMessage({
            command: "endTcpDump",
            parameters: {
                node: state.selectedNode
            }
        })
    }

    function handleDownloadCaptureFile(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        event.preventDefault();
        vscode.postMessage({
            command: "downloadCaptureFile",
            parameters: {
                node: state.selectedNode,
                localcapfile: localcapfile
            }
        })
    }

    function handleSelectChange(event: React.ChangeEvent<HTMLSelectElement>) {
        state.selectedNode = event.target.value;
    }

    return (
        <div className={styles.wrapper}>
            <header className={styles.mainHeading}>
                <h2>TCP Dump from Linux Node {props.clusterName}</h2>
                <VSCodeDivider />
            </header>
            <label htmlFor="nodes">Choose a Node for tcpdump:</label>

            <select name="nodes1" id="nodes1" onChange={handleSelectChange} >
                {props.allNodes.map((nodename) => (
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