import React from "react";
import styles from "./ProgressRing.module.css";

interface ProgressRingProps {
    size?: number;
    className?: string;
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ProgressRing: React.FC<ProgressRingProps> = ({ size = "1rem", className }) => {
    return <div className={`${styles.spinner} ${className || ""}`} style={{ width: size, height: size }} />;
};
