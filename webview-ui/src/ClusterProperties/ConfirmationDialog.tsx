import React from "react";
import styles from "./ClusterProperties.module.css";

export interface ConfirmationDialogProps {
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    cancelLabel: string;
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmationDialog(props: ConfirmationDialogProps) {
    if (!props.isOpen) {
        return null;
    }

    return (
        <div className={styles.dialogOverlay}>
            <div className={styles.dialogContainer}>
                <h3 className={styles.dialogTitle}>{props.title}</h3>
                <div className={styles.dialogContent}>{props.message}</div>
                <div className={styles.dialogActions}>
                    <button className="secondary-button" onClick={props.onCancel}>
                        {props.cancelLabel}
                    </button>
                    <button className="primary-button" onClick={props.onConfirm}>
                        {props.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
