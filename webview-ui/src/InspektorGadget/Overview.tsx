import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEraser, faRocket } from "@fortawesome/free-solid-svg-icons";
import styles from "./InspektorGadget.module.css";
import { getWebviewMessageContext } from "../utilities/vscode";
import { GadgetVersion } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { EventHandlers } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";

export interface OverviewProps {
    status: string
    version: GadgetVersion | null
    userMessageHandlers: EventHandlers<UserMsgDef>
}

export function Overview(props: OverviewProps) {
    const vscode = getWebviewMessageContext<"gadget">();

    function handleDeploy() {
        props.userMessageHandlers.onDeploy();
        vscode.postMessage({ command: "deployRequest", parameters: undefined });
    }

    function handleUndeploy() {
        props.userMessageHandlers.onUndeploy();
        vscode.postMessage({ command: "undeployRequest", parameters: undefined });
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