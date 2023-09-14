import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { CommandCategory, InitialState, PresetCommand, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import styles from "./Kubectl.module.css";
import { getWebviewMessageContext } from "../utilities/vscode";
import { useEffect, useReducer, useState } from "react";
import { CommandList } from "./CommandList";
import { CommandInput } from "./CommandInput";
import { CommandOutput } from "./CommandOutput";
import { SaveCommandDialog } from "./SaveCommandDialog";
import { createState, updateState, userMessageHandler, vscodeMessageHandler } from "./helpers/state";
import { getEventHandlers, getMessageHandler } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";

export function Kubectl(props: InitialState) {
    const vscode = getWebviewMessageContext<"kubectl">();

    const [state, dispatch] = useReducer(updateState, createState(props.customCommands));

    useEffect(() => {
        if (!state.initializationStarted) {
            dispatch({ command: "setInitializing" });
            vscode.postMessage({ command: "getAIKeyStatus", parameters: undefined });
        }

        const msgHandler = getMessageHandler<ToWebViewMsgDef>(dispatch, vscodeMessageHandler);
        vscode.subscribeToMessages(msgHandler);
    });

    const userMessageEventHandlers = getEventHandlers<UserMsgDef>(dispatch, userMessageHandler);

    function handleCommandSelectionChanged(command: PresetCommand) {
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

        const newCommand: PresetCommand = {
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
            <h2>Kubectl Command Run for {props.clusterName}</h2>
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
                explanation={state.explanation}
                isExplanationStreaming={state.isExplanationStreaming}
                aiKeyStatus={state.aiKeyStatus}
                invalidAIKey={state.invalidAIKey}
                userMessageHandlers={userMessageEventHandlers}
            />
        </div>

        <SaveCommandDialog isShown={state.isSaveDialogShown} existingNames={allCommandNames} onCancel={handleSaveDialogCancel} onAccept={handleSaveDialogAccept} />
    </div>
    );
}