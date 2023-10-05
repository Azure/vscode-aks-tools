import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import styles from "./AzureServiceOperator.module.css";
import { InstallStepStatus } from "./helpers/state";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle, faClock, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { InstallStepResult } from "../../../src/webview-contract/webviewDefinitions/azureServiceOperator";

export interface ProgressStepProps {
    description: string
    status: InstallStepStatus
    result: InstallStepResult | null
}

export function ProgressStep(props: ProgressStepProps) {
    return (
    <div className={styles.progressStep}>
        {props.status === InstallStepStatus.NotStarted && <FontAwesomeIcon icon={faClock} />}
        {props.status === InstallStepStatus.InProgress && <VSCodeProgressRing className={styles.progressIndicator} />}
        {props.status === InstallStepStatus.Succeeded && <FontAwesomeIcon className={styles.successIndicator} icon={faCheckCircle} />}
        {props.status === InstallStepStatus.Failed && <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />}
        <p>{props.description}</p>
        {props.result?.errorMessage && <p className={styles.stepErrorMessage}>{props.result.errorMessage}</p>}
        {props.result?.commandResults.map((cmdResult, i) => (
            <pre className={styles.shellOutput} key={i}>
                <span className={styles.command}>❯ {cmdResult.command}{"\n"}</span>
                {cmdResult.stdout && <span className={styles.stdout}>{cmdResult.stdout}{"\n"}</span>}
                {cmdResult.stderr && <span className={styles.stderr}>{cmdResult.stderr}{"\n"}</span>}
            </pre>
        ))}
    </div>
    );
}