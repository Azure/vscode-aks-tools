import { useEffect, useMemo, useRef, useState, KeyboardEvent as ReactKeyboardEvent } from "react";
import styles from "./SearchableDropdown.module.css";
import { Lazy, asLazy, isLoading, orDefault } from "../utilities/lazy";
import { fuzzyMatch } from "../utilities/fuzzy";
import { ProgressRing } from "./ProgressRing";

interface NormalizedOption {
    value: string;
    label: string;
    sortKey: string;
}

export interface SearchableDropdownProps<T> {
    id?: string;
    className?: string;
    // Raw items of any type. Lazy<> is preserved so async loading shows a spinner.
    items: Lazy<T[]> | T[];
    selectedValue: string | null;
    onSelect: (value: string | null) => void;
    disabled?: boolean;
    placeholder?: string;
    // Derive the stable identity (returned by onSelect) from an item.
    getValue: (item: T) => string;
    // Derive the display + fuzzy-search text. Defaults to getValue.
    toLabel?: (item: T) => string;
    // Derive the default sort key (applied when no search text, and as a tiebreaker on equal
    // fuzzy scores). Defaults to toLabel/getValue. Sorted ascending, locale-aware.
    sortKey?: (item: T) => string;
}

export function SearchableDropdown<T>(props: SearchableDropdownProps<T>) {
    const lazyItems = asLazy(props.items);

    if (isLoading(lazyItems)) {
        return <ProgressRing />;
    }

    const rawItems = orDefault(lazyItems, [] as T[]);
    return <SearchableDropdownInner {...props} rawItems={rawItems} />;
}

type InnerProps<T> = SearchableDropdownProps<T> & { rawItems: T[] };

function SearchableDropdownInner<T>(props: InnerProps<T>) {
    const { rawItems, getValue, toLabel, sortKey, selectedValue, onSelect, disabled } = props;

    const [isOpen, setIsOpen] = useState(false);
    const [dropUp, setDropUp] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const options: NormalizedOption[] = useMemo(
        () =>
            rawItems.map((item) => {
                const label = (toLabel ?? getValue)(item);
                return {
                    value: getValue(item),
                    label,
                    sortKey: (sortKey ?? (() => label))(item),
                };
            }),
        [rawItems, getValue, toLabel, sortKey],
    );

    const selectedOption = options.find((o) => o.value === selectedValue) ?? null;

    // When open the input shows the live search text; when closed it shows the selected label.
    const inputText = isOpen ? searchText : (selectedOption?.label ?? "");

    const filtered: NormalizedOption[] = useMemo(() => {
        const matches = options
            .map((option) => ({ option, match: fuzzyMatch(searchText, option.label) }))
            .filter(({ match }) => match.matched);
        matches.sort((a, b) => {
            if (searchText !== "" && b.match.score !== a.match.score) {
                return b.match.score - a.match.score;
            }
            return a.option.sortKey.localeCompare(b.option.sortKey);
        });
        return matches.map(({ option }) => option);
    }, [options, searchText]);

    // Clamp the highlight into range for the current filtered list (derived, not stored).
    const safeHighlight = filtered.length === 0 ? 0 : Math.min(highlightedIndex, filtered.length - 1);

    // Close on outside click.
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearchText("");
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Drop-up positioning when near the viewport bottom.
    useEffect(() => {
        if (isOpen && containerRef.current && listboxRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const menuHeight = listboxRef.current.offsetHeight;
            const shouldDropUp = rect.bottom + menuHeight > window.innerHeight;
            const t = window.setTimeout(() => setDropUp(shouldDropUp), 0);
            return () => window.clearTimeout(t);
        }
        return;
    }, [isOpen, filtered.length]);

    function scrollHighlightIntoView(index: number) {
        listboxRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
    }

    function openDropdown() {
        if (disabled) return;
        setSearchText("");
        const currentIndex = filtered.findIndex((o) => o.value === selectedValue);
        setHighlightedIndex(currentIndex === -1 ? 0 : currentIndex);
        setIsOpen(true);
    }

    function closeDropdown() {
        setIsOpen(false);
        setSearchText("");
    }

    function commitSelection(option: NormalizedOption | undefined) {
        if (!option) return;
        onSelect(option.value);
        closeDropdown();
    }

    function handleInputClick() {
        if (isOpen) {
            closeDropdown();
        } else {
            openDropdown();
            inputRef.current?.focus();
        }
    }

    function handleTextChange(e: React.FormEvent<HTMLInputElement>) {
        if (!isOpen) setIsOpen(true);
        setSearchText(e.currentTarget.value);
        setHighlightedIndex(0);
    }

    function handleKeyDown(e: ReactKeyboardEvent) {
        if (disabled) return;

        if (!isOpen) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
                openDropdown();
                e.preventDefault();
            }
            return;
        }

        switch (e.key) {
            case "ArrowDown": {
                if (filtered.length === 0) break;
                {
                    const next = (safeHighlight + 1) % filtered.length;
                    setHighlightedIndex(next);
                    scrollHighlightIntoView(next);
                }
                e.preventDefault();
                break;
            }
            case "ArrowUp": {
                if (filtered.length === 0) break;
                {
                    const next = (safeHighlight - 1 + filtered.length) % filtered.length;
                    setHighlightedIndex(next);
                    scrollHighlightIntoView(next);
                }
                e.preventDefault();
                break;
            }
            case "Home":
                if (filtered.length === 0) break;
                setHighlightedIndex(0);
                scrollHighlightIntoView(0);
                e.preventDefault();
                break;
            case "End":
                if (filtered.length === 0) break;
                setHighlightedIndex(filtered.length - 1);
                scrollHighlightIntoView(filtered.length - 1);
                e.preventDefault();
                break;
            case "Enter":
                commitSelection(filtered[safeHighlight]);
                e.preventDefault();
                break;
            case "Escape":
                closeDropdown();
                e.preventDefault();
                break;
            case "Tab":
                closeDropdown();
                break;
        }
    }

    const listboxId = props.id ? `${props.id}-list` : undefined;
    const displayListbox = isOpen;

    return (
        <div
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            className={`${styles.dropdown} ${props.className ?? ""}`}
            ref={containerRef}
            onKeyDown={handleKeyDown}
        >
            <div className={styles.inputField}>
                <input
                    ref={inputRef}
                    id={props.id}
                    type="text"
                    className={styles.selectedValue}
                    value={inputText}
                    placeholder={props.placeholder}
                    disabled={disabled}
                    onInput={handleTextChange}
                    onClick={handleInputClick}
                    aria-autocomplete="list"
                    aria-controls={listboxId}
                    aria-activedescendant={
                        isOpen && filtered[safeHighlight] && props.id
                            ? `${props.id}-option-${safeHighlight}`
                            : undefined
                    }
                />
                <svg
                    className={styles.arrowIcon}
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
            </div>

            {displayListbox && (
                <ul
                    id={listboxId}
                    role="listbox"
                    className={`${styles.listbox} ${dropUp ? styles.dropUp : ""}`}
                    ref={listboxRef}
                >
                    {filtered.length === 0 && <li className={styles.empty}>No matches</li>}
                    {filtered.map((option, index) => (
                        <li
                            key={option.value}
                            id={props.id ? `${props.id}-option-${index}` : undefined}
                            role="option"
                            aria-selected={index === safeHighlight}
                            className={`${styles.listboxItem} ${index === safeHighlight ? styles.highlighted : ""}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                commitSelection(option);
                            }}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            {option.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
