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
        <h3>Choose a cluster preset configuration</h3>
        <div className={styles.presetContainer}>
        <VSCodeButton 
                className={styles.preset} appearance="icon" aria-label="Production Standard" onClick={() => handlePresetClick("standard")}
                >
                    <div>
                        <span>icon</span>
                        <span>Production Standard</span>
                        <span>Best for most applications serving production traffic with AKS recommended best practices.</span>
                    </div>
                    
                </VSCodeButton>
                <VSCodeButton 
                className={styles.preset} appearance="icon" aria-label="Dev/Test" onClick={() => handlePresetClick("dev")}
                >
                    <div>
                        <span>icon</span>
                        <span>Dev/Test</span>
                        <span>Best for most applications serving production traffic with AKS recommended best practices.</span>
                    </div>
                </VSCodeButton>
                <VSCodeButton 
                className={styles.preset} appearance="icon" aria-label="Production Economy" onClick={() => handlePresetClick("economy")}
                >
                    <div>
                        <span>icon</span>
                        <span>Production Economy</span>
                        <span>Best for most applications serving production traffic with AKS recommended best practices.</span>
                    </div>
                </VSCodeButton>
                <VSCodeButton 
                className={styles.preset} appearance="icon" aria-label="Production Enterprise" onClick={() => handlePresetClick("enterprise")}
                >
                    <div>
                        <span>icon</span>
                        <span>Production Enterprise</span>
                        <span>Best for most applications serving production traffic with AKS recommended best practices.</span>
                    </div>
                </VSCodeButton>
        </div>
        </>
    )
}