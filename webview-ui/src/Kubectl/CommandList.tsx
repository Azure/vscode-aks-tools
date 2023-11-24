import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { CommandCategory, PresetCommand } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import styles from "./Kubectl.module.css";
import { faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { MouseEvent as ReactMouseEvent } from "react";

export interface CommandListProps {
    id?: string;
    className?: string;
    commands: PresetCommand[];
    selectedCommand: string | null;
    onSelectionChanged: (command: PresetCommand) => void;
    onCommandDelete: (commandName: string) => void;
}

export function CommandList(props: CommandListProps) {
    function handleCommandDelete(e: ReactMouseEvent, commandName: string) {
        e.preventDefault();
        e.stopPropagation();
        props.onCommandDelete(commandName);
    }

    function renderCommands(commands: PresetCommand[], categoryName: string) {
        return (
            <li>
                <h3>{categoryName}</h3>
                <ul className={styles.commandList}>
                    {commands.map((command) => (
                        <li
                            key={command.name}
                            className={command.command === props.selectedCommand ? styles.selected : ""}
                            onClick={() => props.onSelectionChanged(command)}
                        >
                            <div>
                                <h4>{command.name}</h4>
                                <pre>{command.command}</pre>
                            </div>
                            {command.category === CommandCategory.Custom && (
                                <FontAwesomeIcon
                                    className={styles.commandDelete}
                                    style={{ cursor: "pointer" }}
                                    icon={faTrashCan}
                                    onClick={(e) => handleCommandDelete(e, command.name)}
                                />
                            )}
                        </li>
                    ))}
                </ul>
            </li>
        );
    }

    const resourceCommands = props.commands.filter((c) => c.category === CommandCategory.Resources);
    const healthCommands = props.commands.filter((c) => c.category === CommandCategory.Health);
    const customCommands = props.commands.filter((c) => c.category === CommandCategory.Custom);
    return (
        <ul
            id={props.id}
            className={
                props.className ? `${props.className} ${styles.commandCategoryList}` : styles.commandCategoryList
            }
        >
            {renderCommands(resourceCommands, "Resources")}
            {renderCommands(healthCommands, "Health")}
            {customCommands.length > 0 && renderCommands(customCommands, "Custom")}
        </ul>
    );
}
