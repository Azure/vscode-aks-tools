import styles from "./Kubectl.module.css";
import { EventHandlers } from "../utilities/state";
import { EventDef } from "./helpers/state";
import { ProgressRing } from "../components/ProgressRing";

export interface CommandOutputProps {
    isCommandRunning: boolean;
    output: string | null;
    errorMessage: string | null;
    eventHandlers: EventHandlers<EventDef>;
}

export function CommandOutput(props: CommandOutputProps) {
    const hasOutput = props.output !== undefined;
    const hasError = props.errorMessage !== undefined;

    return (
        <>
            {props.isCommandRunning && <ProgressRing />}
            {hasOutput && <pre>{props.output}</pre>}
            {hasError && <pre className={styles.error}>{props.errorMessage}</pre>}
        </>
    );
}
