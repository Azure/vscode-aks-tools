import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { CommandCategory, InitialState, PresetCommand, presetCommands } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import styles from "./Kubectl.module.css";
import { getWebviewMessageContext } from "../utilities/vscode";
import { useEffect, useState } from "react";
import { CommandList } from "./CommandList";
import { CommandInput } from "./CommandInput";
import { CommandOutput } from "./CommandOutput";
import { SaveCommandDialog } from "./SaveCommandDialog";

interface KubectlState {
    allCommands: PresetCommand[]
    selectedCommand: string | null
    isCommandRunning: boolean
    output: string | null
    errorMessage: string | null
    explanation: string | null
    isSaveDialogShown: boolean
}

export function Kubectl(props: InitialState) {
    const vscode = getWebviewMessageContext<"kubectl">();

    const [state, setState] = useState<KubectlState>({
        allCommands: [...presetCommands, ...props.customCommands],
        selectedCommand: null,
        isCommandRunning: false,
        output: null,
        errorMessage: null,
        explanation: null,
        isSaveDialogShown: false
    });

    useEffect(() => {
        vscode.subscribeToMessages({
            runCommandResponse: args => setState({...state, output: args.output, errorMessage: args.errorMessage, explanation: args.explanation, isCommandRunning: false})
        });
    });

    function handleCommandSelectionChanged(command: PresetCommand) {
        setState({...state, selectedCommand: command.command, output: null, errorMessage: null, explanation: null});
    }

    function handleCommandDelete(commandName: string) {
        const allCommands = state.allCommands.filter(cmd => cmd.name !== commandName);
        setState({...state, allCommands});
        vscode.postMessage({ command: "deleteCustomCommandRequest", parameters: {name: commandName} });
    }

    function handleCommandUpdate(command: string) {
        setState({...state, selectedCommand: command});
    }

    function handleRunCommand(command: string) {
        setState({...state, isCommandRunning: true, output: null, errorMessage: null, explanation: null});
        vscode.postMessage({ command: "runCommandRequest", parameters: {command: command.trim()} });
    }

    function handleSaveRequest() {
        setState({...state, isSaveDialogShown: true});
    }

    function handleSaveDialogCancel() {
        setState({...state, isSaveDialogShown: false});
    }

    function handleSaveDialogAccept(commandName: string) {
        if (!state.selectedCommand) {
            return;
        }

        const newCommand: PresetCommand = {
            name: commandName,
            command: state.selectedCommand.trim(),
            category: CommandCategory.Custom
        };

        const allCommands = [...state.allCommands, newCommand].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        setState({...state, allCommands, isSaveDialogShown: false});
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
            <CommandOutput isCommandRunning={state.isCommandRunning} output={state.output} errorMessage={state.errorMessage} explanation={state.explanation}/>
        </div>

        <SaveCommandDialog isShown={state.isSaveDialogShown} existingNames={allCommandNames} onCancel={handleSaveDialogCancel} onAccept={handleSaveDialogAccept} />
    </div>
    );
}