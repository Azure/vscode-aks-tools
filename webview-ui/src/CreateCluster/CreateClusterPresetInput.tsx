import { DevTestIcon } from "../icons/DevTestIcon";
import styles from "./CreateCluster.module.css";

export interface CreateClusterPresetInputProps {
    onPresetSelected: (presetSelected: string) => void;
}

export function CreateClusterPresetInput(props: CreateClusterPresetInputProps) {
    function handlePresetClick(presetSelected: string) {
        console.log(presetSelected);
        props.onPresetSelected(presetSelected);
    }

    return (
        <>
            <div>
                <div className={styles.presetHeader}>
                    <h3>Cluster preset configuration</h3>
                </div>
                <div className={styles.presetContainer} onClick={() => handlePresetClick("dev")}>
                    <div className={styles.flexContainer}>
                        <DevTestIcon className={styles.svgContainer} style={{ width: "1rem", height: "1rem" }} />
                        {/* <div className={styles.svgContainer}>
                        <img src="resources/devtest.svg" />
                    </div> */}
                        <div className={styles.presetTitle}>Dev/Test</div>
                    </div>
                    <div className={styles.presetDescription}>
                        Best for developing new workloads or testing existing workloads.
                        <div className={styles.learnMoreContainer}>
                            <a href="https://learn.microsoft.com/en-us/azure/aks/quotas-skus-regions#cluster-configuration-presets-in-the-azure-portal">
                                Learn more
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
