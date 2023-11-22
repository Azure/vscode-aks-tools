import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import styles from "./AzureServiceOperator.module.css";
import { ProgressStep } from "./ProgressStep";
import { InstallStep, InstallStepStatus } from "./helpers/state";

export type StepWithDescription = {
    step: InstallStep;
    description: string;
};

export interface ProgressProps {
    steps: StepWithDescription[];
}

export function Progress(props: ProgressProps) {
    const succeeded = props.steps[props.steps.length - 1].step.status === InstallStepStatus.Succeeded;
    const failed = props.steps.some((s) => s.step.status === InstallStepStatus.Failed);
    const heading = succeeded ? "Successfully Installed ASO" : failed ? "Failed to Install ASO" : "Progress";

    return (
        <div>
            <h3>
                {succeeded && <FontAwesomeIcon className={styles.successHeadingIcon} icon={faCheckCircle} />}
                {failed && <FontAwesomeIcon className={styles.errorHeadingIcon} icon={faTimesCircle} />}
                {heading}
            </h3>
            {props.steps.map((s) => (
                <ProgressStep key={s.description} description={s.description} {...s.step} />
            ))}
        </div>
    );
}
