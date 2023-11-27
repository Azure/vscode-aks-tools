import { SingleDataset, SingleDetectorARMResponse } from "../../../src/webview-contract/webviewDefinitions/detector";
import { InsightsRenderer } from "./renderers/InsightsRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { Status, getOverallStatus } from "./utils";
import styles from "./Detector.module.css";

export function SingleDetector(detector: SingleDetectorARMResponse) {
    const status = getOverallStatus(detector);
    const panelClassNames = getPanelClassNames(status);

    return (
        <div className={panelClassNames}>
            <div className={styles.detectorPanelHeading}>
                <h3>{detector.properties.metadata.name}</h3>
            </div>
            <div className={styles.detectorPanelBody}>
                {detector.properties.dataset.map(getRenderer).filter((r) => r !== null)}
            </div>
        </div>
    );
}

function getRenderer(dataset: SingleDataset, index: number) {
    switch (dataset.renderingProperties.type) {
        case 7:
            return <InsightsRenderer key={index} {...dataset} />;
        case 9:
            return <MarkdownRenderer key={index} {...dataset} />;
        default:
            return null;
    }
}

function getPanelClassNames(status: Status) {
    switch (status) {
        case Status.Success:
            return `${styles.detectorPanel} ${styles.success}`;
        case Status.Warning:
            return `${styles.detectorPanel} ${styles.warning}`;
        default:
            return `${styles.detectorPanel} ${styles.error}`;
    }
}
