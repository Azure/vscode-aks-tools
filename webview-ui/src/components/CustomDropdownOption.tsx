import React from "react";
import styles from "./CustomDropdown.module.css";

export interface CustomDropdownOptionProps extends Omit<React.LiHTMLAttributes<HTMLLIElement>, "onClick"> {
    id?: string;
    value: string;
    label: string;
    className?: string;
    onClick?: (value: string) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CustomDropdownOption: React.FC<CustomDropdownOptionProps> = ({ id, value, label, className, onClick }) => {
    const handleClick = () => {
        if (onClick) {
            onClick(value);
        }
    };

    return (
        <li id={id} className={`${styles.dropdownOption} ${className}`} onClick={handleClick}>
            {label}
        </li>
    );
};
