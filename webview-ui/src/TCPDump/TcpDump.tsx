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
        vscode.postMessage({ command: "deleteCustomCommandRequest", parameters: {name: commandName} });
    }

    function handleCommandUpdate(command: string) {
        userMessageEventHandlers.onSetSelectedCommand({ command });
    }

    function handleRunCommand(command: string) {
        userMessageEventHandlers.onSetCommandRunning();
        vscode.postMessage({ command: "runCommandRequest", parameters: {command: command.trim()} });
    }

    function handleTerminalRunCommand() {
        // let t = vscodefoo.window.createTerminal("testt");
        // new line is added by default to execute
        // t.sendText(`kubectl get pods`); 
        vscode.postMessage({ command: "runCommandRequest", parameters: {command: `debug node/aks-agentpool-52310376-vmss000008 -it --image=mcr.microsoft.com/dotnet/runtime-deps:6.0`} })
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
    </div>
    );;
}