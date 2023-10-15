import { InitialState, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import styles from "./TcpDump.module.css";
import { getWebviewMessageContext } from "../utilities/vscode";
import { useEffect, useReducer } from "react";
import { StateMessageHandler, chainStateUpdaters, getEventHandlers, getMessageHandler, toStateUpdater } from "../utilities/state";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import * as vscodefoo from 'vscode';

type UserMsgDef = {};

interface TcpDumpState {
    allNodes: string[]
    selectedNode: string
}

function createState(): TcpDumpState {
    return {
        allNodes: [],
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
    const node="aks-agentpool-52310376-vmss000008"
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
                node: node
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
                node: node
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
                node: node
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
                node: node,
                localcapfile: localcapfile
            }
        })
    }

    return (
        <div className={styles.wrapper}>
            <header className={styles.mainHeading}>
                <h2>TCP Dump from Linux Node TESTT {props.clusterName}</h2>
                <VSCodeDivider />
            </header>
            <a href="" onClick={handleCreateDebugPod}>Create Debug Pod</a>
            <a href="" onClick={handleStartCapture}>Play</a>
            <a href="" onClick={handleStopCapture}>Stop</a>
            <a href="" onClick={handleDownloadCaptureFile}>Download</a>
        </div>
    );;
}