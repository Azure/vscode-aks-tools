import { Components } from 'react-markdown'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faExclamationCircle, faExclamationTriangle, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import styles from "../Detector.module.css";

/**
 * Gets a mapping that converts rendered markdown components to custom React elements,
 * so that we can apply our own styling or icons to the markdown that comes from the detectors.
 */
export function getMarkdownComponents(): Components {
    return {
        table: ({node, ...props}) => <table className={styles.markdownTable} {...props} />,
        span: ({node, ...props}) => {
            return (
                <>
                    {getIcons(node?.properties?.className as string[] || [])}
                    <span {...props} />
                </>
            );
        }
    }
}

function getIcons(classNames: string[]) {
    return classNames.map(getIcon).filter(i => i !== null);
}

function getIcon(className: string) {
    switch (className) {
        case "fa-exclamation-triangle": return <FontAwesomeIcon key={className} icon={faExclamationTriangle} className={styles.warningIndicator} />;
        case "fa-exclamation-circle": return <FontAwesomeIcon key={className} icon={faExclamationCircle} className={styles.errorIndicator} />;
        case "fa-check-circle": return <FontAwesomeIcon key={className} icon={faCheckCircle} className={styles.successIndicator} />;
        case "fa-info-circle": return <FontAwesomeIcon key={className} icon={faInfoCircle} className={styles.infoIndicator} />;
        default: return null;
    }
}
