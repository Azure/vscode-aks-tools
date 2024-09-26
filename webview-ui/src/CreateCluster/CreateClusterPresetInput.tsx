import { useEffect, useState } from "react";
import { PresetType } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { AutomaticIcon } from "../icons/AutomaticIcon";
import { DevTestIcon } from "../icons/DevTestIcon";
import styles from "./CreateCluster.module.css";

export interface CreateClusterPresetInputProps {
    onPresetSelected: (presetSelected: PresetType) => void;
}

export function CreateClusterPresetInput(props: CreateClusterPresetInputProps) {
    const [selectedPreset, setSelectedPreset] = useState<PresetType>(PresetType.Automatic);

    useEffect(() => {
        handlePresetClick(PresetType.Automatic);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handlePresetClick(presetSelected: PresetType) {
        console.log(presetSelected);
        props.onPresetSelected(presetSelected);
        setSelectedPreset(presetSelected);
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
                <div style={{ display: "flex" }}>
                    <div
                        className={`${styles.presetContainer} ${selectedPreset === PresetType.Automatic ? styles.presetContainerHighlighted : ""}`}
                        onClick={() => handlePresetClick(PresetType.Automatic)}
                    >
                        <div className={styles.flexContainer}>
                            <AutomaticIcon className={styles.svgContainer} style={{ width: "1rem", height: "1rem" }} />
                            <div className={styles.presetTitle}>Automatic</div>
                        </div>
                        <div className={styles.presetDescription}>
                            Best for production ready that automatically configures the cluster with recommended
                            settings.
                            <div className={styles.learnMoreContainer}>
                                <a href="https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-automatic-deploy?pivots=azure-portal">
                                    Learn more
                                </a>
                            </div>
                        </div>
                    </div>

                    <div
                        className={`${styles.presetContainer} ${selectedPreset === PresetType.Dev ? styles.presetContainerHighlighted : ""}`}
                        onClick={() => handlePresetClick(PresetType.Dev)}
                    >
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
                </div>
            </div>
        </>
    );
}
