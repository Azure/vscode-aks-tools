import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { CommandCategory, InitialState, PresetCommand } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import styles from "./Kubectl.module.css";
import { CommandList } from "./CommandList";
import { CommandInput } from "./CommandInput";
import { CommandOutput } from "./CommandOutput";
import { SaveCommandDialog } from "./SaveCommandDialog";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./helpers/state";
import { useEffect } from "react";

export function Kubectl(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    function handleCommandSelectionChanged(command: PresetCommand) {
        eventHandlers.onSetSelectedCommand({ command: command.command });
    }

    function handleCommandDelete(commandName: string) {
        const allCommands = state.allCommands.filter((cmd) => cmd.name !== commandName);
        eventHandlers.onSetAllCommands({ allCommands });
        vscode.postDeleteCustomCommandRequest({ name: commandName });
    }

    function handleCommandUpdate(command: string) {
        eventHandlers.onSetSelectedCommand({ command });
    }

    function handleRunCommand(command: string) {
        eventHandlers.onSetCommandRunning();
        vscode.postRunCommandRequest({ command: command.trim() });
    }

    function handleSaveRequest() {
        eventHandlers.onSetSaveDialogVisibility({ shown: true });
    }

    function handleSaveDialogCancel() {
        eventHandlers.onSetSaveDialogVisibility({ shown: false });
    }

    function handleSaveDialogAccept(commandName: string) {
        eventHandlers.onSetSaveDialogVisibility({ shown: false });
        if (!state.selectedCommand) {
            return;
        }

        const newCommand: PresetCommand = {
            name: commandName,
            command: state.selectedCommand.trim(),
            category: CommandCategory.Custom,
        };

        const allCommands = [...state.allCommands, newCommand].sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        eventHandlers.onSetAllCommands({ allCommands });
        vscode.postAddCustomCommandRequest(newCommand);
    }

    const allCommandNames = state.allCommands.map((cmd) => cmd.name);
    const commandLookup = Object.fromEntries(state.allCommands.map((cmd) => [cmd.command, cmd]));
    const matchesExisting = state.selectedCommand !== null ? state.selectedCommand.trim() in commandLookup : false;

    useEffect(() => {
        const command = initialState?.initialCommand?.trim();
        if (command) {
            eventHandlers.onSetSelectedCommand({ command });
        }
        // dependencies are not needed as this effect runs only once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className={styles.wrapper}>
            <header className={styles.mainHeading}>
                <h2>Kubectl Command Run for {state.clusterName}</h2>
                <VSCodeDivider />
            </header>
            <nav className={styles.commandNav}>
                <CommandList
                    commands={state.allCommands}
                    selectedCommand={state.selectedCommand}
                    onSelectionChanged={handleCommandSelectionChanged}
                    onCommandDelete={handleCommandDelete}
                />
            </nav>
            <div className={styles.mainContent}>
                <CommandInput
                    command={state.selectedCommand || ""}
                    matchesExisting={matchesExisting}
                    onCommandUpdate={handleCommandUpdate}
                    onRunCommand={handleRunCommand}
                    onSaveRequest={handleSaveRequest}
                />
                <VSCodeDivider />
                <CommandOutput
                    isCommandRunning={state.isCommandRunning}
                    output={state.output}
                    errorMessage={state.errorMessage}
                    eventHandlers={eventHandlers}
                />
            </div>

            <SaveCommandDialog
                isShown={state.isSaveDialogShown}
                existingNames={allCommandNames}
                onCancel={handleSaveDialogCancel}
                onAccept={handleSaveDialogAccept}
            />
        </div>
    );
}
