import { CommandCategory, InitialState, TCPPresetCommand, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import styles from "../Kubectl/Kubectl.module.css";
import { getWebviewMessageContext } from "../utilities/vscode";
import { useEffect, useReducer } from "react";
import { CommandList } from "../Kubectl/CommandList";
import { CommandInput } from "../Kubectl/CommandInput";
import { CommandOutput } from "../Kubectl/CommandOutput";
import { SaveCommandDialog } from "../Kubectl/SaveCommandDialog";
import { createState, updateState, userMessageHandler, vscodeMessageHandler } from "../Kubectl/helpers/state";
import { getEventHandlers, getMessageHandler } from "../utilities/state";
import { UserMsgDef } from "../Kubectl/helpers/userCommands";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import * as vscodefoo from 'vscode';


export function TcpDump(props: InitialState) {
    const vscode = getWebviewMessageContext<"kubectl">();
    const node="aks-agentpool-52310376-vmss000008"
    const nodecapfile=`/tmp/nodeuniquename.cap`;
    const localcapfile=`/tmp/localuniquename.cap`;
    const [state, dispatch] = useReducer(updateState, createState(props.customCommands));

    useEffect(() => {
        if (!state.initializationStarted) {
            dispatch({ command: "setInitializing" });
        }

        const msgHandler = getMessageHandler<ToWebViewMsgDef>(dispatch, vscodeMessageHandler);
        vscode.subscribeToMessages(msgHandler);
    });

    const userMessageEventHandlers = getEventHandlers<UserMsgDef>(dispatch, userMessageHandler);

    function handleCommandSelectionChanged(command: TCPPresetCommand) {
        userMessageEventHandlers.onSetSelectedCommand({ command: command.command });
    }

    function handleCommandDelete(commandName: string) {
        const allCommands = state.allCommands.filter(cmd => cmd.name !== commandName);
        userMessageEventHandlers.onSetAllCommands({ allCommands });
        vscode.postMessage({ command: "deleteCustomCommandRequest", parameters: { name: commandName } });
    }

    function handleCommandUpdate(command: string) {
        userMessageEventHandlers.onSetSelectedCommand({ command });
    }

    function handleRunCommand(command: string) {
        userMessageEventHandlers.onSetCommandRunning();
        vscode.postMessage({ command: "runCommandRequest", parameters: { command: command.trim() } });
    }

    function handleTerminalRunCommand() {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        vscode.postMessage({
            command: "runCommandRequest", parameters: {
                command: `apply -f - << EOF
                apiVersion: v1
                kind: Pod
                metadata:
                  name: debug-${node}
                  namespace: default
                spec:
                  containers:
                  - args: ["-c", "sleep infinity"]
                    command: ["/bin/sh"]
                    image: docker.io/corfr/tcpdump
                    imagePullPolicy: IfNotPresent
                    name: debug
                    resources: {}
                    securityContext:
                      privileged: true
                      runAsUser: 0
                    volumeMounts:
                    - mountPath: /host
                      name: host-volume
                  volumes:
                  - name: host-volume
                    hostPath:
                      path: /
                  dnsPolicy: ClusterFirst
                  nodeSelector:
                      kubernetes.io/hostname: ${node}
                  restartPolicy: Never
                  securityContext: {}
                  hostIPC: true
                  hostNetwork: true
                  hostPID: true
                EOF`}
        })
    }

    function handleTerminalRunCommandPlay() {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        
        vscode.postMessage({
            command: "runCommandRequest", parameters: {
                command: `exec debug-${node} -- /bin/sh -c "tcpdump --snapshot-length=0 -vvv -w ${nodecapfile} 1>/dev/null 2>&1 &"`}
        })
    }

    function handleTerminalRunCommandStop() {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 

        vscode.postMessage({
            command: "runCommandRequest", parameters: {
                command: `exec debug-${node} -- /bin/sh -c "pkill tcpdump"`}
        })
    }

    function handleTerminalRunCommandCopy() {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        vscode.postMessage({
            command: "runCommandRequest", parameters: {
                command: `cp debug-$node:${nodecapfile} ${localcapfile}`}
        })
    }

    function handleSaveRequest() {
        userMessageEventHandlers.onSetSaveDialogVisibility({ shown: true });
    }

    function handleSaveDialogCancel() {
        userMessageEventHandlers.onSetSaveDialogVisibility({ shown: false });
    }

    function handleSaveDialogAccept(commandName: string) {
        userMessageEventHandlers.onSetSaveDialogVisibility({ shown: false });
        if (!state.selectedCommand) {
            return;
        }

        const newCommand: TCPPresetCommand = {
            name: commandName,
            command: state.selectedCommand.trim(),
            category: CommandCategory.Custom
        };

        const allCommands = [...state.allCommands, newCommand].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        userMessageEventHandlers.onSetAllCommands({ allCommands });
        vscode.postMessage({ command: "addCustomCommandRequest", parameters: newCommand });
    }

    const allCommandNames = state.allCommands.map(cmd => cmd.name);
    const commandLookup = Object.fromEntries(state.allCommands.map(cmd => [cmd.command, cmd]));
    const matchesExisting = state.selectedCommand != null ? state.selectedCommand.trim() in commandLookup : false;

    return (
        <div className={styles.wrapper}>
            <header className={styles.mainHeading}>
                <h2>Kubectl Command Run for TESTT {props.clusterName}</h2>
                <VSCodeDivider />
            </header>
            <nav className={styles.commandNav}>
                <CommandList commands={state.allCommands} selectedCommand={state.selectedCommand} onSelectionChanged={handleCommandSelectionChanged} onCommandDelete={handleCommandDelete} />
            </nav>
            <div className={styles.mainContent}>
                <CommandInput command={state.selectedCommand || ''} matchesExisting={matchesExisting} onCommandUpdate={handleCommandUpdate} onRunCommand={handleRunCommand} onSaveRequest={handleSaveRequest} />
                <VSCodeDivider />
                <CommandOutput
                    isCommandRunning={state.isCommandRunning}
                    output={state.output}
                    errorMessage={state.errorMessage}
                    userMessageHandlers={userMessageEventHandlers}
                />
            </div>

            <SaveCommandDialog isShown={state.isSaveDialogShown} existingNames={allCommandNames} onCancel={handleSaveDialogCancel} onAccept={handleSaveDialogAccept} />
            <a href="" onClick={(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => handleTerminalRunCommand()}>Get Node Dump</a>
            <a href="" onClick={(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => handleTerminalRunCommandPlay()}>Play</a>
            <a href="" onClick={(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => handleTerminalRunCommandStop()}>Stop</a>
            <a href="" onClick={(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => handleTerminalRunCommandCopy()}>Copy</a>
        </div>
    );;
}