import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEraser, faRocket } from "@fortawesome/free-solid-svg-icons";
import styles from "./InspektorGadget.module.css";
import semver from "semver";
import { GadgetVersion } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { EventHandlers } from "../utilities/state";
import { EventDef, vscode } from "./helpers/state";

export interface OverviewProps {
    status: string;
    version: GadgetVersion | null;
    eventHandlers: EventHandlers<EventDef>;
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

    function isValidVersionString(ver: string | null): boolean {
        if (ver === null || !ver.startsWith("v")) return false;
        const version = ver.substring(1);
        return semver.valid(version) !== null;
    }

    return (
        <>
            {props.status && <p>{props.status}</p>}
            {props.version && props.version.server && (
                <>
                    <dl className={styles.propertyList}>
                        <dt>Client Version:&nbsp;</dt>
                        <dd>{props.version.client}</dd>
                        <dt>Server Version:&nbsp;</dt>
                        <dd>{props.version.server}</dd>
                    </dl>
                    <button className="secondary-button" onClick={handleUndeploy}>
                        <FontAwesomeIcon icon={faEraser} />
                        &nbsp;Undeploy
                    </button>
                    &nbsp;&nbsp;&nbsp;
                </>
            )}
            {props.version && !isValidVersionString(props.version.server) && (
                <button onClick={handleDeploy}>
                    <FontAwesomeIcon icon={faRocket} />
                    &nbsp;Deploy
                </button>
            )}
        </>
    );
}
