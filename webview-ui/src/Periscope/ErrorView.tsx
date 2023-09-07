import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { KustomizeConfig } from "../../../src/webview-contract/webviewDefinitions/periscope";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimesCircle } from '@fortawesome/free-solid-svg-icons';
import styles from "./Periscope.module.css";

export interface ErrorViewProps {
    clusterName: string
    message: string
    config: KustomizeConfig
}

export function ErrorView(props: ErrorViewProps) {
    return (
        <>
            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
            AKS Periscope failed to run on '{props.clusterName}'. Please see the error below for more details.

            <VSCodeDivider />

            <h3>Periscope settings (from VS Code Configuration)</h3>
            <dl className={styles.settinglist}>
                <dt>GitHub organisation (containing aks-periscope repo with Kustomize base)</dt>
                <dd>{props.config.repoOrg}</dd>

                <dt>Container registry (containing Periscope image to deploy)</dt>
                <dd>{props.config.containerRegistry}</dd>

                <dt>Image version (tag for {props.config.containerRegistry}/aks/periscope image)</dt>
                <dd>{props.config.imageVersion}</dd>

                <dt>Release tag (for {props.config.repoOrg}/aks-periscope GitHub repo)</dt>
                <dd>{props.config.releaseTag}</dd>
            </dl>

            <VSCodeDivider />

            <pre>{props.message}</pre>
        </>
    );
}