import { useState } from "react";
import styles from "./KaitoModels.module.css";
import kaitoSupporterModel from "../../../resources/kaitollmconfig/kaitollmconfig.json";
import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { vscode2 } from "./state";

function capitalizeFirstLetter(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function extractModelSource(url: string) {
    const match = url.match(/https:\/\/huggingface\.co\/([^/]+)/);
    return match ? match[1] : "Unknown";
}

export function KaitoModels() {
    const modelFamilies: { [key: string]: string[] } = kaitoSupporterModel.modelsupported;
    const modelDetails = kaitoSupporterModel.modelDetails;

    // Identify the first family key
    const firstFamilyKey = Object.keys(modelFamilies)[0];

    // Set the initial state of openDropdowns to have the first family key set to true
    const [openDropdowns, setOpenDropdowns] = useState<{ [key: string]: boolean }>({
        [firstFamilyKey]: true,
    });
    const [selectedModel, setSelectedModel] = useState<string | null>(null);

    const toggleDropdown = (family: string) => {
        setOpenDropdowns((prev) => ({
            ...prev,
            [family]: !prev[family],
        }));
    };

    const getModelDetails = (modelName: string) => {
        return modelDetails.find((model) => model.modelName === modelName);
    };

    const handleModelClick = (model: string) => {
        setSelectedModel(model);
    };

    const selectedModelDetails = getModelDetails(selectedModel !== null ? selectedModel : "");

    function stringOrUndefined(s: string | undefined): string {
        return s !== undefined ? s : "";
    }

    function generateCRD() {
        const name = stringOrUndefined(selectedModelDetails?.modelName);
        const yaml = `apiVersion: kaito.sh/v1alpha1
kind: Workspace
metadata:
  name: workspace-${name}
resource:
  instanceType: "${stringOrUndefined(selectedModelDetails?.minimumGpu)}"
  labelSelector:
    matchLabels:
      apps: ${name}
inference:
  preset:
    name: "${name}"`;
        vscode2.postGenerateCRDRequest({ model: yaml });
        return;
    }

    return (
        <div className={styles.mainDiv}>
            <h2>Create a KAITO Workspace</h2>
            <VSCodeDivider />
            <div className={styles.subHeader}>
                To create a KAITO workspace, select one of the models from the list below, then click &quot;Generate
                Workspace CRD&quot;. This will create a .yml file that can be used to deploy the workspace to your
                cluster. Learn more about deploying KAITO workspaces{" "}
                <VSCodeLink target="_blank" href="https://github.com/Azure/kaito?tab=readme-ov-file#quick-start">
                    here.
                </VSCodeLink>
            </div>
            {Object.keys(modelFamilies).map((family) => (
                <div key={family} className={styles.dropdown}>
                    <button className={styles.dropdownButton} onClick={() => toggleDropdown(family)}>
                        <span
                            className={styles.arrow}
                            style={{
                                transform: openDropdowns[family] ? "rotate(-90deg)" : "rotate(0deg)",
                            }}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="none"
                            >
                                <path
                                    fillRule="evenodd"
                                    clipRule="evenodd"
                                    d="M7.97612 10.0719L12.3334 5.71461L12.9521 6.33333L8.28548 11L7.66676 11L3.0001 6.33333L3.61882 5.71461L7.97612 10.0719Z"
                                    fill="white"
                                />
                            </svg>
                        </span>
                        {capitalizeFirstLetter(family)}
                    </button>
                    {openDropdowns[family] && (
                        <div className={styles.dropdownContent}>
                            <div className={styles.gridContainer}>
                                {modelFamilies[family].map((model) => {
                                    const details = getModelDetails(model);
                                    return (
                                        <div
                                            key={model}
                                            className={`${styles.gridItem} ${selectedModel === model ? styles.selected : ""}`}
                                            onClick={() => handleModelClick(model)}
                                        >
                                            <div className={styles.modelName}>{model}</div>
                                            {details && (
                                                <div className={styles.modelDetails}>
                                                    <div>
                                                        Minimum GPU size:{" "}
                                                        <span className={styles.gray}>{details.minimumGpu}</span>
                                                    </div>
                                                    <div>
                                                        Compatible Kaito Versions:{" "}
                                                        <span className={styles.gray}>v{details.kaitoVersion}+</span>
                                                    </div>
                                                    <div>
                                                        Model source:{" "}
                                                        <a
                                                            className={styles.link}
                                                            href={details.modelSource}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                        >
                                                            {extractModelSource(details.modelSource)}
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                            {selectedModel === model && (
                                                <button onClick={() => generateCRD()} className={styles.generateButton}>
                                                    Generate Workspace CRD
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
