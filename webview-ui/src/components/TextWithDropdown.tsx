import { FormEvent, HTMLAttributes, useEffect, useRef, useState } from "react";
import styles from "./TextWithDropdown.module.css";
import { VSCodeProgressRing, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { Lazy, asLazy, isLoaded, isLoading, isNotLoaded, orDefault } from "../utilities/lazy";

type AvailableHtmlAttributes = Pick<HTMLAttributes<HTMLElement>, "className" | "id">;
type ChangeEvent = Event | FormEvent<HTMLElement>;
type SelectionItem = {
    isAddItem: boolean;
    value: string;
    displayText: string;
    isSelected: boolean;
};

export interface TextWithDropdownProps extends AvailableHtmlAttributes {
    items: Lazy<string[]> | string[];
    getAddItemText: (text: string) => string;
    selectedItem: string | null;
    onSelect: (value: string | null, isNew: boolean) => void;
}

enum DisplayMode {
    TextField,
    Loader,
    Dropdown,
}

function getDisplayMode(items: Lazy<string[]>): DisplayMode {
    if (isLoading(items)) {
        return DisplayMode.Loader;
    }

    if (isNotLoaded(items) || (isLoaded(items) && items.value.length === 0)) {
        return DisplayMode.TextField;
    }

    return DisplayMode.Dropdown;
}

export function TextWithDropdown(props: TextWithDropdownProps) {
    const lazyItems = asLazy(props.items);
    const displayMode = getDisplayMode(lazyItems);
    return (
        <>
            {displayMode === DisplayMode.TextField && <TextOnly {...props} />}
            {displayMode === DisplayMode.Loader && <VSCodeProgressRing style={{ height: "1rem" }} />}
            {displayMode === DisplayMode.Dropdown && (
                <NonLazyTextWithDropdown {...{ ...props, items: orDefault(lazyItems, []) }} />
            )}
        </>
    );
}

type TextOnlyProps = Omit<TextWithDropdownProps, "items">;

function TextOnly(props: TextOnlyProps) {
    function handleTextChange(e: ChangeEvent) {
        const newText = (e.currentTarget as HTMLInputElement).value;
        props.onSelect(newText, true);
    }

    return <VSCodeTextField className={props.className} onInput={handleTextChange} value={props.selectedItem || ""} />;
}

type NonLazyTextWithDropdownProps = Omit<TextWithDropdownProps, "items"> & { items: string[] };

function NonLazyTextWithDropdown(props: NonLazyTextWithDropdownProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [allItems, setAllItems] = useState([...props.items]);

    const listboxRef = useRef<HTMLOListElement>(null);

    useEffect(() => {
        // If there are any items in props that aren't in allItems, reset allItems
        if (props.items.some((item) => !allItems.includes(item))) {
            setAllItems([...props.items]);
        }
    }, [props.items, allItems]);

    const itemLookup = new Map(allItems.map((item) => [item.toLowerCase(), item]));
    const canAddItem = searchText ? !itemLookup.has(searchText.toLowerCase()) : false;
    const addItems = createAddItems(canAddItem, props.getAddItemText(searchText), searchText, props.selectedItem);
    const filteredItems = createFilteredItems(allItems, searchText, props.selectedItem);
    const selectionItems: SelectionItem[] = [...addItems, ...filteredItems];
    const inputText = props.selectedItem || searchText;

    function setSelected(value: string | null) {
        const isNew = value !== null && !props.items.includes(value);
        props.onSelect(value, isNew);
    }

    function handleTextFieldClick() {
        // For consistency with the VS Code dropdown, we toggle the dropdown when the text field is clicked.
        setIsExpanded(!isExpanded);
    }

    function handleDropDownButtonClick(e: React.MouseEvent) {
        // Don't propagate because the containing element (the text field) has its own click handler
        // which will itself toggle the expanded state.
        e.stopPropagation();
        setIsExpanded(!isExpanded);
    }

    function handleFocus() {
        // Work around the fact that focus events are fired before click events.
        // If we don't delay the expansion, the dropdown will be expanded and then immediately collapsed
        // by the click event handler.
        // A 250ms delay is enough to be reasonably sure that the click event has been processed.
        // This is admittedly not completely robust, but:
        // 1. The consequences of getting the timing wrong are minor (user might need to expand the listbox again).
        // 2. The delay is only noticable when tabbing into the field (click events are processed immediately).
        setTimeout(() => {
            setIsExpanded(true);
        }, 250);
    }

    function handleBlur(e: React.FocusEvent) {
        const selectedItem = selectionItems.find((item) => item.isSelected) || null;
        selectItem(selectedItem);

        // The relatedTarget property is the form element that took the focus away.
        const newFocusTargetIsOutsideListbox =
            e.relatedTarget === null || (listboxRef.current && !listboxRef.current.contains(e.relatedTarget));

        // If the selected item was an "add" item, the fact that we just selected it will have caused
        // it to disappear from the listbox, meaning it won't receive a 'click' event, which we rely on to
        // collapse the listbox. If this is the case, we collapse the listbox here.
        const collapseListbox = selectedItem?.isAddItem || newFocusTargetIsOutsideListbox;

        if (collapseListbox) {
            setIsExpanded(false);
        }
    }

    function handleListboxFocus(e: React.FocusEvent) {
        // Listbox focus events can be fired when users click on items in the listbox, and in these cases are
        // followed by a click event, which will toggle the expanded state and hide the listbox.
        // If we allow this event to bubble up to the container, it will set the state back to expanded, so we
        // prevent this from happening here.
        e.stopPropagation();
    }

    function handleTextChange(e: ChangeEvent) {
        const newText = (e.currentTarget as HTMLInputElement).value.trim();
        const newSelectedValue = itemLookup.get(newText.toLowerCase()) || null;
        setSearchText(newSelectedValue ? "" : newText);
        setSelected(newSelectedValue);
    }

    function handleItemClick(e: React.MouseEvent, item: SelectionItem) {
        e.preventDefault();
        e.stopPropagation();
        selectItem(item);
        setIsExpanded(false);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        const currentIndex = selectionItems.findIndex((item) => item.isSelected);

        if (e.key === "ArrowDown") {
            const newIndex = Math.min(selectionItems.length - 1, currentIndex + 1);
            const newValue = selectionItems[newIndex].value || null;
            setSelected(newValue);
        } else if (e.key === "ArrowUp") {
            const newIndex = Math.max(0, currentIndex - 1);
            const newValue = selectionItems[newIndex].value;
            setSelected(newValue);
        } else if (e.key === "Enter" && currentIndex !== -1) {
            selectItem(selectionItems[currentIndex]);
            setIsExpanded(!isExpanded);
        } else if (e.key === "Escape") {
            setIsExpanded(false);
        }
    }

    function selectItem(item: SelectionItem | null) {
        if (item === null) {
            setSelected(null);
        } else if (item.isAddItem) {
            const newItemValue = searchText;
            setAllItems([newItemValue, ...allItems]);
            setSelected(newItemValue);
        } else {
            setSelected(item.value);
        }

        setSearchText("");
    }

    const displayListbox = isExpanded && selectionItems.length > 0;

    return (
        <div
            role="combobox"
            style={{ position: "relative" }}
            className={props.className}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
        >
            <VSCodeTextField
                className={styles.selectedValue}
                onInput={handleTextChange}
                value={inputText}
                onClick={handleTextFieldClick}
            >
                <span slot="end" className={styles.indicator} onClick={handleDropDownButtonClick} tabIndex={-1}>
                    {/* 
                    See: 
                    https://github.com/microsoft/vscode-webview-ui-toolkit/blob/a1f078e963969ad3f6d5932f96874f1a41cda919/src/dropdown/index.ts#L43-L57
                    */}
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                    >
                        <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"
                        ></path>
                    </svg>
                </span>
            </VSCodeTextField>

            <ol
                className={`${styles.listbox} ${displayListbox ? "" : styles.hidden}`}
                tabIndex={-1}
                onFocus={handleListboxFocus}
                ref={listboxRef}
            >
                {selectionItems.map((item) => (
                    <li
                        className={`${styles.listboxItem} ${item.isSelected ? styles.selected : ""}`}
                        onClick={(e) => handleItemClick(e, item)}
                        key={item.value}
                    >
                        {item.displayText}
                    </li>
                ))}
            </ol>
        </div>
    );
}

function createAddItems(
    canAddItem: boolean,
    displayText: string,
    value: string,
    selectedItem: string | null,
): SelectionItem[] {
    if (!canAddItem) {
        return [];
    }

    return [{ isAddItem: true, value, displayText, isSelected: selectedItem === null }];
}

function createFilteredItems(allItems: string[], searchText: string, selectedItem: string | null): SelectionItem[] {
    return allItems
        .filter((item) => item.toLowerCase().includes(searchText.toLowerCase()))
        .map((item) => ({
            isAddItem: false,
            value: item,
            displayText: item,
            isSelected: item === selectedItem,
        }));
}
