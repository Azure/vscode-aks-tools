import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClone, faDownload } from "@fortawesome/free-solid-svg-icons";

export interface NodeActionsProps {
    runId: string;
    nodeName: string;
    containerUrl: string;
    shareableSas: string;
    isUploaded: boolean;
}

export function NodeActions(props: NodeActionsProps) {
    const shareableLink = `${props.containerUrl}/${props.runId}/${props.nodeName}/${props.nodeName}.zip${props.shareableSas}`;

    function copyShareLink(e: React.MouseEvent) {
        e.stopPropagation();
        navigator.clipboard.writeText(shareableLink);
    }

    return (
        <>
            <button onClick={copyShareLink}>
                <FontAwesomeIcon icon={faClone} />
                &nbsp;Copy 7-Day Shareable Link
            </button>
            &nbsp;
            {props.isUploaded && (
                <a href={shareableLink} title={shareableLink} target="_blank" rel="noreferrer">
                    <FontAwesomeIcon icon={faDownload} />
                    &nbsp;Download Zip
                </a>
            )}
        </>
    );
}
