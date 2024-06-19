import { IconDefinition, faCheckCircle, faClock } from "@fortawesome/free-solid-svg-icons";
import styles from "./InlineAction.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

export function makeFixAction(
    icon: IconDefinition,
    name: string,
    action: (() => void) | null,
    isPrimary: boolean,
): FixAction {
    return {
        isPrimary,
        icon,
        name,
        action: action ? action : () => {},
        canPerformAction: action !== null,
    };
}

export function makeInlineActionProps(description: string, ...actions: FixAction[]): InlineActionProps {
    return {
        isDone: false,
        description,
        actions,
        extraInfo: "",
    };
}

export type InlineActionProps = {
    isDone: boolean;
    description: string;
    actions: FixAction[];
    extraInfo: string;
};

export type FixAction = {
    isPrimary: boolean;
    canPerformAction: boolean;
    icon: IconDefinition;
    action: () => void;
    name: string;
};

export function InlineAction(props: InlineActionProps) {
    return (
        <div className={styles.actionItem}>
            <div className={styles.actionDescription}>
                {props.isDone ? (
                    <FontAwesomeIcon icon={faCheckCircle} className={styles.successIndicator} />
                ) : (
                    <FontAwesomeIcon icon={faClock} />
                )}{" "}
                {props.description}{" "}
                {props.extraInfo && (
                    <span className={"tooltip-holder"} data-tooltip-text={props.extraInfo}>
                        <i className={`${styles.inlineIcon} codicon codicon-info`} />
                    </span>
                )}
            </div>
            <div className={styles.actionButtons}>
                {props.actions.map((action, i) => (
                    <VSCodeButton
                        key={i}
                        appearance={action.isPrimary ? "primary" : "secondary"}
                        onClick={action.action}
                        disabled={!action.canPerformAction}
                    >
                        <span className={styles.inlineIcon}>
                            <FontAwesomeIcon icon={action.icon} />
                        </span>{" "}
                        {action.name}
                    </VSCodeButton>
                ))}
            </div>
        </div>
    );
}
