import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import * as l10n from "@vscode/l10n";
import { fuzzyMatch } from "../utilities/fuzzy";
import styles from "./SearchableDropdown.module.css";

export interface SearchableDropdownItem {
    /** Stable identity returned by `onSelect`. */
    value: string;
    /** Primary text, and the main thing matched against. */
    label: string;
    /** Secondary line, also matched against. */
    detail?: string;
    /** Short right-aligned note beside the label, e.g. a relative timestamp. */
    meta?: string;
    /** Short uppercase tag, e.g. "private". */
    badge?: string;
}

export interface SearchableDropdownProps {
    id?: string;
    items: SearchableDropdownItem[];
    selectedValue: string | null;
    placeholder?: string;
    noMatchesText?: string;
    disabled?: boolean;
    className?: string;
    onSelect: (value: string | null) => void;
}

/**
 * Combobox that filters as you type, for lists too long to scan by eye.
 *
 * Differs from `CustomDropdown` (prefix-only type-ahead over flat string labels) and
 * `TextWithDropdown` (fuzzy, but value and display text are the same string): this one keeps
 * `value` separate from the displayed row, so a rich row can front an opaque identifier.
 */
export function SearchableDropdown(props: SearchableDropdownProps) {
    const { items, selectedValue, onSelect } = props;
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);

    const selectedItem = useMemo(
        () => items.find((item) => item.value === selectedValue) ?? null,
        [items, selectedValue],
    );

    // An empty query keeps the caller's order (the repo list arrives sorted by last push);
    // a non-empty one ranks by match quality.
    const filtered = useMemo(() => {
        if (query.trim() === "") return items;
        return items
            .map((item) => {
                const labelMatch = fuzzyMatch(query, item.label);
                const detailMatch = item.detail ? fuzzyMatch(query, item.detail) : { matched: false, score: 0 };
                return {
                    item,
                    matched: labelMatch.matched || detailMatch.matched,
                    score: Math.max(labelMatch.score, detailMatch.score),
                };
            })
            .filter((r) => r.matched)
            .sort((a, b) => b.score - a.score)
            .map((r) => r.item);
    }, [items, query]);

    useEffect(() => {
        function onPointerDown(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setQuery("");
            }
        }
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        listboxRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, isOpen]);

    function commit(index: number) {
        const item = filtered[index];
        if (!item) return;
        onSelect(item.value);
        setQuery("");
        setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                    return;
                }
                setActiveIndex((i) =>
                    filtered.length === 0 ? 0 : (Math.min(i, filtered.length - 1) + 1) % filtered.length,
                );
                break;
            case "ArrowUp":
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                    return;
                }
                setActiveIndex((i) =>
                    filtered.length === 0
                        ? 0
                        : (Math.min(i, filtered.length - 1) - 1 + filtered.length) % filtered.length,
                );
                break;
            case "Enter":
                if (isOpen) {
                    event.preventDefault();
                    commit(safeActiveIndex);
                }
                break;
            case "Escape":
                if (isOpen) {
                    event.preventDefault();
                    setIsOpen(false);
                    setQuery("");
                }
                break;
            case "Home":
                if (isOpen) {
                    event.preventDefault();
                    setActiveIndex(0);
                }
                break;
            case "End":
                if (isOpen) {
                    event.preventDefault();
                    setActiveIndex(Math.max(0, filtered.length - 1));
                }
                break;
            case "Tab":
                setIsOpen(false);
                setQuery("");
                break;
        }
    }

    const listboxId = props.id ? `${props.id}-listbox` : undefined;
    const optionId = (index: number) => (props.id ? `${props.id}-option-${index}` : undefined);
    // Filtering can shrink the list under the cursor, so clamp rather than tracking it in an effect.
    const safeActiveIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    // While open the input is a search box; while closed it displays the current selection.
    const inputValue = isOpen ? query : (selectedItem?.label ?? "");
    const showClear = !isOpen && selectedItem !== null && !props.disabled;

    return (
        <div ref={containerRef} className={`${styles.container} ${props.className ?? ""}`}>
            <div className={styles.inputRow}>
                <input
                    type="text"
                    id={props.id}
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    aria-activedescendant={isOpen && filtered.length > 0 ? optionId(safeActiveIndex) : undefined}
                    aria-autocomplete="list"
                    autoComplete="off"
                    className={styles.input}
                    disabled={props.disabled}
                    placeholder={props.placeholder}
                    value={inputValue}
                    onChange={(e) => {
                        setQuery(e.currentTarget.value);
                        setActiveIndex(0);
                        if (!isOpen) setIsOpen(true);
                    }}
                    onClick={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                />
                {showClear && (
                    <button
                        type="button"
                        className={styles.clearButton}
                        aria-label={l10n.t("Clear selection")}
                        onClick={() => {
                            onSelect(null);
                            setQuery("");
                        }}
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                )}
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

            <ul
                ref={listboxRef}
                id={listboxId}
                role="listbox"
                className={`${styles.listbox} ${isOpen ? "" : styles.hidden}`}
            >
                {filtered.length === 0 ? (
                    <li className={styles.noMatches}>{props.noMatchesText ?? l10n.t("No matches")}</li>
                ) : (
                    filtered.map((item, index) => (
                        <li
                            key={item.value}
                            id={optionId(index)}
                            role="option"
                            aria-selected={item.value === selectedValue}
                            className={`${styles.option} ${index === safeActiveIndex ? styles.optionActive : ""}`}
                            onMouseEnter={() => setActiveIndex(index)}
                            // mousedown fires before the input's blur, so the click isn't lost.
                            onMouseDown={(e) => {
                                e.preventDefault();
                                commit(index);
                            }}
                        >
                            <span className={styles.optionHeader}>
                                <span className={styles.optionLabel}>{item.label}</span>
                                {item.meta && <span className={styles.optionMeta}>{item.meta}</span>}
                                {item.badge && <span className={styles.optionBadge}>{item.badge}</span>}
                            </span>
                            {item.detail && <span className={styles.optionDetail}>{item.detail}</span>}
                        </li>
                    ))
                )}
            </ul>
        </div>
    );
}
