import { Preset } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { DevTestIcon } from "../icons/DevTestIcon";
import styles from "./CreateCluster.module.css";

export interface CreateClusterPresetInputProps {
    onPresetSelected: (presetSelected: Preset) => void;
}

export function CreateClusterPresetInput(props: CreateClusterPresetInputProps) {
    function handlePresetClick(presetSelected: Preset) {
        console.log(presetSelected);
        props.onPresetSelected(presetSelected);
    }

    return (
        <>
            <div>
                <div className={styles.presetHeader}>
                    <h3>Cluster preset configuration</h3>
                </div>
                <div className={styles.portalLink}>
                    If you wish to create a more complex Azure Kubernetes Service (AKS) cluster, please&nbsp;
                    <a href="https://portal.azure.com/#create/Microsoft.AKS">click here</a>
                    &nbsp;to visit the Azure Portal.
                </div>
                <div style={{ display: 'flex' }}> 
                <div className={styles.presetContainer} onClick={() => handlePresetClick("dev")}>
                    <div className={styles.flexContainer}>
                        <DevTestIcon className={styles.svgContainer} style={{ width: "1rem", height: "1rem" }} />
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

                <div className={styles.presetContainer} onClick={() => handlePresetClick("automatic")}>
                    <div className={styles.flexContainer}>
                        <DevTestIcon className={styles.svgContainer} style={{ width: "1rem", height: "1rem" }} />
                        <div className={styles.presetTitle}>Automatic</div>
                    </div>
                    <div className={styles.presetDescription}>
                    Best for production ready that automatically configures the cluster with recommended settings.
                        <div className={styles.learnMoreContainer}>
                            <a href="https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-automatic-deploy?pivots=azure-portal">
                                Learn more
                            </a>
                        </div>
                    </div>
                </div>
                </div>
               
            </div>
        </>
    );
}
