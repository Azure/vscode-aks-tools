import { useState } from "react";
import styles from "./KaitoModels.module.css";
import kaitoSupporterModel from "../../../resources/kaitollmconfig/kaitollmconfig.json";
import { VSCodeDivider, VSCodeLink, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { stateUpdater2, vscode2 } from "./state";
import { useStateManagement } from "../utilities/state";
import { ArrowIcon } from "../icons/ArrowIcon";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoModels";

export function KaitoModels(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater2, initialState, vscode2);

    function capitalizeFirstLetter(text: string) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function extractModelSource(url: string) {
        const match = url.match(/https:\/\/huggingface\.co\/([^/]+)/);
        return match ? match[1] : "Unknown";
    }

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

    const handleModelClick = async (model: string) => {
        if (selectedModel !== null) {
            if (model !== selectedModel) {
                vscode2.postCancelRequest({});
            }
        }
        if (selectedModel !== model) {
            resetState();
        }
        setSelectedModel(model);
    };

    // const selectedModelDetails = getModelDetails(selectedModel !== null ? selectedModel : "");
    function stringOrUndefined(s: string | undefined): string {
        return s !== undefined ? s : "";
    }

    function undeployable(model: string) {
        return model.substring(0, 7) === "llama-2" || model.substring(0, 5) === "phi-3";
    }

    const defaultMessage = <>Please note deployment time can vary from 10 minutes to 1hr+.</>;
    function tooltipMessage(model: string) {
        if (model.substring(0, 7) === "llama-2") {
            return (
                <>
                    Llama2 models require privately referenced images for deployment. You must create a CRD and specify
                    the location of your privately hosted image. Learn more{" "}
                    <a
                        target="_blank"
                        rel="noreferrer"
                        href="https://github.com/Azure/kaito/tree/main/presets/models/llama2"
                    >
                        here.
                    </a>
                </>
            );
        } else if (model.substring(0, 5) === "phi-3") {
            return (
                <>
                    Phi-3 is only supported in v0.3+ of KAITO. This cluster currently has version 0.2 of KAITO
                    installed.
                </>
            );
        }
        return defaultMessage;
    }

    function generateYAML(model: string) {
        const modelDetails = getModelDetails(model);
        const name = stringOrUndefined(modelDetails?.modelName);
        const gpu = stringOrUndefined(modelDetails?.minimumGpu);
        let appname = name;
        let metadataname = name;
        let inferencename = name;
        if (name.substring(0, 5) === "phi-3") {
            appname = "phi-3";
            const match = name.match(/phi-3-(mini|medium)/);
            if (match !== null) {
                metadataname = match[0];
            }
            inferencename = name;
        }
        const yaml = `apiVersion: kaito.sh/v1alpha1
kind: Workspace
metadata:
  name: workspace-${metadataname}
resource:
  instanceType: "${gpu}"
  labelSelector:
    matchLabels:
      apps: ${appname}
inference:
  preset:
    name: ${inferencename}`;
        return yaml;
    }

    function generateCRD(model: string) {
        const yaml = generateYAML(model);
        vscode2.postGenerateCRDRequest({ model: yaml });
        return;
    }

    function onClickDeployKaito(model: string) {
        const yaml = generateYAML(model);
        vscode2.postDeployKaitoRequest({ model: model, yaml: yaml });
    }

    function resetState() {
        vscode2.postResetStateRequest({});
    }

    return (
        <>
            <div className={`${styles.mainGridContainer} ${selectedModel ? styles.openSidebar : ""}`}>
                {selectedModel !== null && (
                    <div className={styles.panelDiv}>
                        <h1>{selectedModel}</h1>
                        <div className={styles.nextSteps}>
                            <div className={styles.nextIcon}>
                                <span>
                                    <i className="codicon codicon-sparkle"></i>
                                </span>
                            </div>
                            <div className={styles.content}>
                                <h2>Next steps</h2>
                                <p>If this is your preferred model for deployment in your application, proceed to:</p>
                                <ul>
                                    <li>Generate the model workspace custom resource definition (CRD)</li>
                                    <li>Optionally Customize workspace CRD.</li>
                                    <li>Deploy to cluster</li>
                                </ul>
                            </div>
                        </div>

                        <button
                            className={styles.closeButton}
                            onClick={() => {
                                vscode2.postCancelRequest({});
                                setSelectedModel(null);
                            }}
                        >
                            &times;
                        </button>

                        {selectedModel === selectedModel &&
                            (() => {
                                const details = getModelDetails(selectedModel);
                                return (
                                    <>
                                        <div className={styles.modelDetails}>
                                            {(!state.workspaceExists || !(selectedModel === state.modelName)) && (
                                                /* {false && ( */
                                                <>
                                                    <button
                                                        className={styles.generateButton}
                                                        disabled={undeployable(selectedModel)}
                                                        onClick={() => onClickDeployKaito(selectedModel)}
                                                    >
                                                        Deploy default workspace CRD
                                                    </button>

                                                    <span className={styles.tooltip}>
                                                        <span className={styles.infoIndicator}>
                                                            <div className="icon">
                                                                <i
                                                                    className={`codicon codicon-info ${styles.iicon}`}
                                                                ></i>
                                                            </div>
                                                        </span>
                                                        <span className={styles.tooltiptext}>
                                                            {tooltipMessage(selectedModel)}
                                                        </span>
                                                    </span>
                                                </>
                                            )}
                                            <br />

                                            <button
                                                onClick={() => generateCRD(selectedModel)}
                                                className={styles.generateButton}
                                            >
                                                Customize workspace CRD
                                            </button>

                                            {selectedModel === state.modelName &&
                                                state.workspaceExists &&
                                                !state.workspaceReady &&
                                                (() => {
                                                    if (state.age > 360) {
                                                        return (
                                                            <>
                                                                <div className={styles.failure}>
                                                                    <span className={styles.bold}>
                                                                        Deployment unsucessful. Please delete this
                                                                        workspace from your cluster and try again.
                                                                    </span>
                                                                </div>
                                                            </>
                                                        );
                                                    }
                                                    return (
                                                        <>
                                                            <div className={styles.progressDiv}>
                                                                <VSCodeProgressRing className={styles.progress} />
                                                                <span className={styles.bold}>
                                                                    Deployment in progress
                                                                </span>
                                                            </div>
                                                            <div className={styles.statusTable}>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>Name:</span>
                                                                    <span className={styles.gray}>
                                                                        workspace-
                                                                        {selectedModel}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>
                                                                        Instance:
                                                                    </span>
                                                                    <span className={styles.gray}>
                                                                        {details && details.minimumGpu}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>
                                                                        Resource Ready:
                                                                    </span>
                                                                    <span className={styles.gray}>
                                                                        {state.resourceReady === null
                                                                            ? "In-progress"
                                                                            : state.resourceReady
                                                                              ? "True"
                                                                              : "False"}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>
                                                                        Inference Ready:
                                                                    </span>
                                                                    <span className={styles.gray}>
                                                                        {state.inferenceReady === null
                                                                            ? "In-progress"
                                                                            : state.inferenceReady
                                                                              ? "True"
                                                                              : "False"}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>
                                                                        Workspace Ready:
                                                                    </span>
                                                                    <span className={styles.gray}>
                                                                        {state.workspaceReady === null
                                                                            ? "In-progress"
                                                                            : state.workspaceReady
                                                                              ? "True"
                                                                              : "False"}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>Age:</span>
                                                                    <span className={styles.gray}>{state.age}m</span>
                                                                </div>
                                                            </div>
                                                        </>
                                                    );
                                                })()}

                                            {selectedModel === state.modelName &&
                                                state.workspaceExists &&
                                                state.workspaceReady && (
                                                    /* {true && ( */
                                                    <>
                                                        <div className={styles.sucess}>
                                                            <span className={styles.bold}>
                                                                Model successfully deployed!
                                                            </span>
                                                        </div>
                                                    </>
                                                )}
                                        </div>
                                    </>
                                );
                            })()}
                    </div>
                )}
                {selectedModel !== null && <div className={styles.sidePanel}></div>}
                <div className={styles.mainDiv}>
                    <h2>Create a KAITO Workspace ({state.clusterName})</h2>
                    <VSCodeDivider />
                    <div className={styles.subHeader}>
                        To get your model up and running, you can either create a CRD file with &quot;Generate CRD&quot;
                        which you can then deploy using kubectl apply -f filename.yml, or to deploy a model with default
                        settings, just click &quot;Deploy Workspace&quot;. This will deploy a workspace with default
                        settings. Learn more about deploying KAITO workspaces{" "}
                        <VSCodeLink
                            target="_blank"
                            href="https://github.com/Azure/kaito?tab=readme-ov-file#quick-start"
                        >
                            here.
                        </VSCodeLink>
                        <br />
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
                                    <ArrowIcon className={styles.arrowPath} />
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
                                                                <span className={styles.gray}>
                                                                    {details.minimumGpu}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                Compatible Kaito Versions:{" "}
                                                                <span className={styles.gray}>
                                                                    {details.kaitoVersion}
                                                                </span>
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
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
