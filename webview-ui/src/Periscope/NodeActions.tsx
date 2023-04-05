import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClone } from '@fortawesome/free-regular-svg-icons';
import styles from "./Periscope.module.css";

export interface NodeActionsProps {
    runId: string
    nodeName: string
    containerUrl: string
    shareableSas: string
    isUploaded: boolean
}

export function NodeActions(props: NodeActionsProps) {
    const shareableLink = `${props.containerUrl}/${props.runId}/${props.nodeName}/${props.nodeName}.zip${props.shareableSas}`;

    function copyShareLink(e: React.MouseEvent) {
        e.stopPropagation();
        navigator.clipboard.writeText(shareableLink);
    }

    return (
        <>
            <VSCodeButton onClick={copyShareLink}>
                <FontAwesomeIcon className={styles.inlineIcon} icon={faClone} />
                &nbsp;Copy 7-Day Shareable Link
            </VSCodeButton>
            &nbsp;
            {
                props.isUploaded && (
                    <VSCodeLink onClick={e => e.stopPropagation()} href={shareableLink} target="_blank">
                        ⭳&nbsp;Download Zip
                    </VSCodeLink>
                )
            }
        </>
    )
}