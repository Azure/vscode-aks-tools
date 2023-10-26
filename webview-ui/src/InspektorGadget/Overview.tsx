import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEraser, faRocket } from "@fortawesome/free-solid-svg-icons";
import styles from "./InspektorGadget.module.css";
import { GadgetVersion } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { EventHandlers } from "../utilities/state";
import { EventDef, vscode } from "./helpers/state";

export interface OverviewProps {
    status: string
    version: GadgetVersion | null
    eventHandlers: EventHandlers<EventDef>
}

export function Overview(props: OverviewProps) {
    function handleDeploy() {
        props.eventHandlers.onDeploy();
        vscode.postDeployRequest();
    }

    function handleUndeploy() {
        props.eventHandlers.onUndeploy();
        vscode.postUndeployRequest();
    }

    return (
    <>
        {props.status && (
            <p>{props.status}</p>
        )}
        {props.version && props.version.server && (
            <>
                <dl className={styles.propertyList}>
                    <dt>Client Version</dt><dd>{props.version.client}</dd>
                    <dt>Server Version</dt><dd>{props.version.server}</dd>
                </dl>
                <br/>
                <VSCodeButton onClick={handleUndeploy}>
                    <FontAwesomeIcon icon={faEraser} />
                    &nbsp;Undeploy
                </VSCodeButton>
            </>
        )}
        {props.version && !props.version.server && (
            <VSCodeButton onClick={handleDeploy}>
                <FontAwesomeIcon icon={faRocket} />
                &nbsp;Deploy
            </VSCodeButton>
        )}
    </>
    );
}