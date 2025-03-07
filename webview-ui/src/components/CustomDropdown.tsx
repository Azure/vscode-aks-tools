import React, {
    useState,
    useEffect,
    useRef,
    ReactNode,
    ReactElement,
    KeyboardEvent,
    MouseEvent as ReactMouseEvent,
} from "react";
import styles from "./CustomDropdown.module.css";

interface CustomDropdownProps {
    id?: string;
    value?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    children?: ReactNode;
    className?: string;
}

function isReactElement(child: ReactNode): child is ReactElement<{
    value: string;
    label: string;
    onClick?: (value: string) => void;
    id?: string;
    className?: string;
}> {
    return React.isValidElement(child);
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export const CustomDropdown: React.FC<CustomDropdownProps> = ({
    id,
    value,
    disabled,
    onChange,
    children,
    className,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [dropUp, setDropUp] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    // tracks the currently typed search term
    const [searchTerm, setSearchTerm] = useState("");
    const searchTimeout = useRef<number | undefined>(undefined);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLUListElement>(null);

    // handle toggling of dropdown menu
    const handleToggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
        // prevents conflicting default behaviors
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) {
            const childrenArray = React.Children.toArray(children).filter(isReactElement);
            const selectedIndex = childrenArray.findIndex((child) => child.props.value === value);
            setHighlightedIndex(selectedIndex !== -1 ? selectedIndex : 0);
            setIsOpen(!isOpen);
        }
    };

    // handle selection of dropdown option
    const handleOptionClick = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
    };

    // handle all other clicks outside the dropdown
    const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
            setIsOpen(false);
        }
    };

    // Cleanup the search timeout on unmount
    useEffect(() => {
        return () => {
            if (searchTimeout.current) {
                clearTimeout(searchTimeout.current);
            }
        };
    }, []);

    // handling all key inputs
    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        // if key is alphanumeric, update the search term
        if (event.key.length === 1 && /^[a-z0-9]$/i.test(event.key)) {
            const newSearchTerm = searchTerm + event.key.toLowerCase();
            setSearchTerm(newSearchTerm);

            // if a search timeout is already set, clear it
            if (searchTimeout.current) {
                clearTimeout(searchTimeout.current);
            }
            // this gives the user 500ms to type the next character
            searchTimeout.current = window.setTimeout(() => {
                setSearchTerm("");
            }, 500);

            const childrenArray = React.Children.toArray(children).filter(isReactElement);
            // matching for the first element that starts with the search term
            const matchIndex = childrenArray.findIndex((child) =>
                child.props.label.toLowerCase().startsWith(newSearchTerm),
            );

            // if match is found, update the highlighted index
            if (matchIndex !== -1) {
                if (isOpen) {
                    setHighlightedIndex(matchIndex);
                    // scrolls the matched element into view
                    menuRef.current?.children[matchIndex]?.scrollIntoView({ block: "nearest" });
                } else {
                    // If dropdown is closed, update the selected value immediately
                    onChange(childrenArray[matchIndex].props.value);
                }
                event.preventDefault();
            }
            return;
        }

        // if dropdown is closed, open it and prevent default behavior
        if (!isOpen) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                setIsOpen(true);
                event.preventDefault();
            }
            return;
        }

        // handling key inputs on open dropdown menu
        switch (event.key) {
            case "ArrowDown":
                setHighlightedIndex((prevIndex) => {
                    const newIndex = (prevIndex + 1) % React.Children.count(children);
                    menuRef.current?.children[newIndex]?.scrollIntoView({ block: "nearest" });
                    return newIndex;
                });
                event.preventDefault();
                break;
            case "ArrowUp":
                setHighlightedIndex((prevIndex) => {
                    const count = React.Children.count(children);
                    const newIndex = (prevIndex - 1 + count) % count;
                    menuRef.current?.children[newIndex]?.scrollIntoView({ block: "nearest" });
                    return newIndex;
                });
                event.preventDefault();
                break;
            case "Enter": {
                const childrenArray = React.Children.toArray(children).filter(isReactElement);
                const selectedChild = childrenArray[highlightedIndex] as ReactElement<{
                    value: string;
                }>;
                handleOptionClick(selectedChild.props.value);
                event.preventDefault();
                break;
            }
            case "Escape":
                setIsOpen(false);
                event.preventDefault();
                break;
        }
    };

    // handle clicks outside the dropdown
    useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside as EventListener);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside as EventListener);
        };
    }, []);

    // handle dropdown menu positioning
    useEffect(() => {
        if (isOpen && dropdownRef.current && menuRef.current) {
            const dropdownRect = dropdownRef.current.getBoundingClientRect();
            const menuHeight = menuRef.current.offsetHeight;
            const viewportHeight = window.innerHeight;

            if (dropdownRect.bottom + menuHeight > viewportHeight) {
                setDropUp(true);
            } else {
                setDropUp(false);
            }
        }
    }, [isOpen]);

    const childrenArray = React.Children.toArray(children).filter(isReactElement);
    // updates visible button label based on highlighted index
    const buttonLabel =
        isOpen && childrenArray[highlightedIndex]
            ? childrenArray[highlightedIndex].props.label
            : childrenArray.find((child) => child.props.value === value)?.props.label || "Select";

    // body of the dropdown component
    return (
        <div className={`${styles.dropdown} ${className}`} ref={dropdownRef}>
            <button
                id={id}
                className={styles.dropdownButton}
                onClick={handleToggle}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                {buttonLabel}
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
            </button>
            {isOpen && (
                <ul
                    className={`${styles.dropdownMenu} ${dropUp ? styles.dropUp : ""}`}
                    ref={menuRef}
                    role="listbox"
                    aria-activedescendant={`${id}-option-${highlightedIndex}`}
                >
                    {React.Children.map(children, (child, index) =>
                        isReactElement(child)
                            ? React.cloneElement(child, {
                                  onClick: () => handleOptionClick(child.props.value),
                                  id: `${id}-option-${index}`,
                                  className: index === highlightedIndex ? styles.highlightedOption : "",
                              })
                            : child,
                    )}
                </ul>
            )}
        </div>
    );
};
