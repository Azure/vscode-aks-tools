import { FormEvent, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { VSCodeButton, VSCodeCheckbox, VSCodeDivider, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import styles from "./FilePicker.module.css";
import {
    Directory,
    FileOrDirectory,
    asPathParts,
    asPathString,
    findFileSystemItem,
    isDirectory,
    matchesFilter,
} from "../utilities/testFileSystemUtils";
import {
    FileFilters,
    OpenFileOptions,
    OpenFileResult,
    SaveFileOptions,
    SaveFileResult,
} from "../../../../src/webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { Maybe, hasValue, isNothing, just, nothing } from "../../utilities/maybe";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export type FilePickerProps = {
    shown: boolean;
    rootDir: Directory;
    isSaving: boolean;
    options: SaveFileOptions | OpenFileOptions;
    closeRequested: (result: SaveFileResult | OpenFileResult | null) => void;
};

export function FilePicker(props: FilePickerProps) {
    const initialState = getInitialState(props);
    const [newItem, setNewItem] = useState<FileOrDirectory | null>(initialState.newItem);
    const [existingItems, setExistingItems] = useState<FileOrDirectory[]>(
        initialState.existingItem ? [initialState.existingItem] : [],
    );

    const selectedItems = newItem ? [...existingItems, newItem] : existingItems;
    const suggestedFilename = getSuggestedName(props);
    const mustExist = !props.isSaving;
    const isDirectory = !props.isSaving && (props.options as OpenFileOptions).type === "directory";
    const canSelectMany = (!props.isSaving && (props.options as OpenFileOptions).canSelectMany) || false;

    let treeSelectedItems: FileOrDirectory[];
    if (canSelectMany) {
        treeSelectedItems = selectedItems;
    } else if (newItem) {
        // Select the parent directory
        treeSelectedItems = [findFileSystemItem(props.rootDir, newItem.path)!];
    } else {
        treeSelectedItems = existingItems;
    }

    function handleItemSelectionChange(item: FileOrDirectory) {
        if (item.type === "directory" && props.isSaving && suggestedFilename) {
            const itemPath = [...item.path, suggestedFilename];
            const updatedExistingItem = findFileSystemItem(props.rootDir, itemPath);
            setExistingItems(updatedExistingItem ? [updatedExistingItem] : []);
            if (!updatedExistingItem) {
                setNewItem(createNewItem(props, [item], suggestedFilename));
            }
        } else {
            if (existingItems.includes(item)) {
                setExistingItems(existingItems.filter((i) => i !== item));
            } else if (canSelectMany) {
                setExistingItems([...existingItems, item]);
            } else {
                setExistingItems([item]);
            }
        }
    }

    function handleFilenameChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        const filename = input.value.trim();
        if (filename) {
            const updatedNewItem = createNewItem(props, selectedItems, filename);
            setNewItem(updatedNewItem);
            const existingItem = findFileSystemItem(props.rootDir, [...updatedNewItem.path, updatedNewItem.name]);
            setExistingItems(existingItem ? [existingItem] : []);
        } else {
            setNewItem(null);
        }
    }

    function validate(): Maybe<SaveFileResult | OpenFileResult> {
        if (!props.isSaving) {
            const itemsOfType = existingItems.filter((item) => item.type === (props.options as OpenFileOptions).type);
            if (itemsOfType.length === 0) return nothing();
            const paths = itemsOfType.map((item) => `/${item.path.join("/")}/${item.name}`);
            return just({ paths } as OpenFileResult);
        }

        if (selectedItems.length !== 1) return nothing();
        const selectedItem = selectedItems[0];
        return just({
            path: asPathString(selectedItem),
            exists: selectedItem !== newItem,
        });
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const result = validate();
        if (hasValue(result)) {
            props.closeRequested(result.value);
        }
    }

    return (
        <Dialog isShown={props.shown} onCancel={() => props.closeRequested(null)}>
            <h2>{props.options.title}</h2>

            <form onSubmit={handleSubmit}>
                <VSCodeDivider />
                <FileSystemNodes
                    items={[props.rootDir]}
                    filters={props.options.filters || {}}
                    directoriesOnly={!props.isSaving && (props.options as OpenFileOptions).type === "directory"}
                    canSelectMany={canSelectMany}
                    handleItemSelectionChange={handleItemSelectionChange}
                    selectedItems={treeSelectedItems}
                />

                <div className={styles.inputContainer}>
                    <label className={styles.label} htmlFor="filename-input">
                        {isDirectory ? "Directory:" : "File:"}
                    </label>
                    {(!canSelectMany || selectedItems.length <= 1) && (
                        <VSCodeTextField
                            id="filename-input"
                            className={styles.control}
                            value={selectedItems.length === 1 ? selectedItems[0].name : ""}
                            readOnly={mustExist}
                            onInput={handleFilenameChange}
                        />
                    )}
                </div>

                <div className={styles.buttonContainer}>
                    <VSCodeButton type="submit" disabled={isNothing(validate())}>
                        {props.options.buttonLabel || "Select"}
                    </VSCodeButton>
                    <VSCodeButton appearance="secondary" onClick={() => props.closeRequested(null)}>
                        Cancel
                    </VSCodeButton>
                </div>
            </form>
        </Dialog>
    );
}

type InitialState = {
    newItem: FileOrDirectory | null;
    existingItem: FileOrDirectory | null;
};

function getSuggestedName(props: FilePickerProps): string | null {
    const defaultPathParts = props.options.defaultPath ? asPathParts(props.options.defaultPath) : [];
    return defaultPathParts.length > 0 ? defaultPathParts[defaultPathParts.length - 1] : null;
}

function getInitialState(props: FilePickerProps): InitialState {
    const defaultPathParts = props.options.defaultPath ? asPathParts(props.options.defaultPath) : [];
    const suggestedName = getSuggestedName(props);
    const canCreateNewItem = props.isSaving && suggestedName ? true : false;
    const newItem = canCreateNewItem ? createNewItem(props, [], suggestedName!) : null;

    const startPathParts = defaultPathParts.length > 0 ? defaultPathParts : props.rootDir.path;
    const existingItem = findFileSystemItem(props.rootDir, startPathParts);

    return { newItem, existingItem };
}

function createNewItem(props: FilePickerProps, selectedItems: FileOrDirectory[], filename: string): FileOrDirectory {
    const defaultPathParts = props.options.defaultPath ? asPathParts(props.options.defaultPath) : [];
    let path = defaultPathParts || props.rootDir.path;
    if (selectedItems.length === 1) {
        const selectedItem = selectedItems[0];
        path = selectedItem.type === "directory" ? [...selectedItem.path, selectedItem.name] : selectedItem.path;
    }

    return {
        name: filename,
        type: "file",
        path,
    };
}

type FileSystemNodesProps = {
    items: FileOrDirectory[];
    filters: FileFilters;
    directoriesOnly: boolean;
    canSelectMany: boolean;
    handleItemSelectionChange: (item: FileOrDirectory) => void;
    selectedItems: FileOrDirectory[];
};

function FileSystemNodes(props: FileSystemNodesProps) {
    return (
        <ul className={styles.nodeList}>
            {props.items.map((item) => (
                <FileSystemNode
                    key={`${item.path.join("/")}/${item.name}`}
                    item={item}
                    filters={props.filters}
                    directoriesOnly={props.directoriesOnly}
                    canSelectMany={props.canSelectMany}
                    selectedItems={props.selectedItems}
                    handleItemSelectionChange={props.handleItemSelectionChange}
                />
            ))}
        </ul>
    );
}

type FileSystemNodeProps = {
    item: FileOrDirectory;
    filters: FileFilters;
    directoriesOnly: boolean;
    canSelectMany: boolean;
    handleItemSelectionChange: (item: FileOrDirectory) => void;
    selectedItems: FileOrDirectory[];
};

function FileSystemNode(props: FileSystemNodeProps) {
    const [expanded, setExpanded] = useState(false);

    function handleToggleExpand() {
        setExpanded(isDirectory(props.item) && !expanded);
    }

    function ignoreClick(e: Event | FormEvent<HTMLElement>) {
        e.preventDefault();
        e.stopPropagation();
    }

    const isSelected = props.selectedItems.includes(props.item);
    const itemClassNames = [styles.item, isSelected ? styles.selected : ""].filter((n) => !!n).join(" ");

    return (
        <>
            <li>
                {isDirectory(props.item) && (
                    <FontAwesomeIcon
                        icon={expanded ? faChevronDown : faChevronRight}
                        className={styles.expander}
                        onClick={handleToggleExpand}
                    />
                )}
                {props.canSelectMany && !isDirectory(props.item) && (
                    <VSCodeCheckbox
                        checked={isSelected}
                        onClick={ignoreClick}
                        onChange={() => props.handleItemSelectionChange(props.item)}
                        style={{ margin: "0", paddingRight: "0.5rem" }}
                    />
                )}
                <span onClick={() => props.handleItemSelectionChange(props.item)} className={itemClassNames}>
                    {props.item.name}
                </span>
                {expanded && isDirectory(props.item) && (
                    <FileSystemNodes
                        items={props.item.contents.filter((item) =>
                            matchesFilter(item, props.filters, props.directoriesOnly),
                        )}
                        filters={props.filters}
                        directoriesOnly={props.directoriesOnly}
                        canSelectMany={props.canSelectMany}
                        handleItemSelectionChange={props.handleItemSelectionChange}
                        selectedItems={props.selectedItems}
                    />
                )}
            </li>
        </>
    );
}
