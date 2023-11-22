import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import styles from "./CreateCluster.module.css";

export interface CreateClusterPresetInputProps {
    onPresetSelected: (presetSelected: string) => void
}

export function CreateClusterPresetInput(props: CreateClusterPresetInputProps) {

    function handlePresetClick(presetSelected: string) {
        console.log(presetSelected);
        props.onPresetSelected(presetSelected);
    }

    return (
        <>
            <div className={styles.presetContainer} onClick={() => handlePresetClick("dev")}>
                <div>
                    <img src="resources/createCluster/devtest.png" alt="Dev/Test" />
                </div>
                <div className={styles.presetTitle}>
                    Dev/Test
                </div>
                <div className={styles.presetDescription}>
                    Best for developing new workloads or testing existing workloads.
                    <div>
                        <a href="https://learn.microsoft.com/en-us/azure/aks/quotas-skus-regions#cluster-configuration-presets-in-the-azure-portal">Learn more</a>
                    </div>
                </div>
            </div>
        </>
    )
}