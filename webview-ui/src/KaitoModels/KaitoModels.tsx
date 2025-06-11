import { useState } from "react";
import styles from "./KaitoModels.module.css";
import kaitoSupporterModel from "../../../resources/kaitollmconfig/kaitollmconfig.json";
import { stateUpdater, vscode } from "./state";
import { useStateManagement } from "../utilities/state";
import { ArrowIcon } from "../icons/ArrowIcon";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoModels";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";

export function KaitoModels(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);

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
                vscode.postCancelRequest({ model: selectedModel });
            }
        }
        if (selectedModel !== model) {
            resetState();
        }
        setSelectedModel(model);
    };

    const defaultMessage = <>{l10n.t("Please note deployment time can vary from 10 minutes to 1hr+.")}</>;
    function tooltipMessage() {
        return defaultMessage;
    }
    function generateCRD(model: string) {
        const yaml = generateKaitoYAML(model).yaml;
        vscode.postGenerateCRDRequest({ model: yaml });
        return;
    }

    function onClickDeployKaito(model: string) {
        const { yaml, gpu } = generateKaitoYAML(model);
        if (!(gpu === undefined)) {
            vscode.postDeployKaitoRequest({ model, yaml, gpu });
        }
    }
    function redirectKaitoManage() {
        vscode.postKaitoManageRedirectRequest({});
    }

    function resetState() {
        vscode.postResetStateRequest({});
    }

    return (
        <div className={styles.main}>
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
                                <h2>{l10n.t("Next steps")}</h2>
                                <p>
                                    {l10n.t(
                                        "If this is your preferred model for deployment in your application, proceed to:",
                                    )}
                                </p>
                                <ul>
                                    <li>{l10n.t("Generate the model workspace custom resource definition (CRD)")}</li>
                                    <li>{l10n.t("Optionally Customize workspace CRD.")}</li>
                                    <li>{l10n.t("Deploy to cluster")}</li>
                                </ul>
                            </div>
                        </div>

                        <button
                            className={styles.closeButton}
                            onClick={() => {
                                vscode.postCancelRequest({ model: selectedModel });
                                vscode.postResetStateRequest({});
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
                                                <>
                                                    <div>
                                                        <button
                                                            className={styles.button}
                                                            onClick={() => onClickDeployKaito(selectedModel)}
                                                        >
                                                            {l10n.t("Deploy default workspace CRD")}
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
                                                                {tooltipMessage()}
                                                            </span>
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                            <div>
                                                <button
                                                    onClick={() => generateCRD(selectedModel)}
                                                    className={styles.button}
                                                >
                                                    {l10n.t("Customize workspace CRD")}
                                                </button>
                                            </div>

                                            {selectedModel === state.modelName &&
                                                state.workspaceExists &&
                                                !state.workspaceReady &&
                                                (() => {
                                                    if (state.age > 360) {
                                                        return (
                                                            <>
                                                                <div className={styles.failure}>
                                                                    <span className={styles.bold}>
                                                                        {l10n.t(
                                                                            "Deployment unsucessful. Please delete this workspace from your cluster and try again.",
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            </>
                                                        );
                                                    }
                                                    return (
                                                        <>
                                                            <div className={styles.progressDiv}>
                                                                <ProgressRing className={styles.progress} />
                                                                <span className={styles.bold}>
                                                                    {l10n.t("Deployment in progress")}
                                                                </span>
                                                            </div>
                                                            <div className={styles.statusTable}>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>
                                                                        {l10n.t("Name:")}
                                                                    </span>
                                                                    <span className={styles.gray}>
                                                                        workspace-
                                                                        {selectedModel}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>
                                                                        {l10n.t("Instance:")}
                                                                    </span>
                                                                    <span className={styles.gray}>
                                                                        {details && details.minimumGpu}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.statusRow}>
                                                                    <span className={styles.statusLabel}>
                                                                        {l10n.t("Resource Ready:")}
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
                                                                        {l10n.t("Inference Ready:")}
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
                                                                        {l10n.t("Workspace Ready:")}
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
                                                                    <span className={styles.statusLabel}>
                                                                        {l10n.t("Age:")}
                                                                    </span>
                                                                    <span className={styles.gray}>
                                                                        {convertMinutesToFormattedAge(state.age)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </>
                                                    );
                                                })()}

                                            {selectedModel === state.modelName &&
                                                state.workspaceExists &&
                                                state.workspaceReady && (
                                                    <>
                                                        <div className={styles.success}>
                                                            <span className={styles.successSpan}>
                                                                {l10n.t("Model successfully deployed!")}
                                                            </span>
                                                        </div>
                                                        <button onClick={redirectKaitoManage} className={styles.button}>
                                                            {l10n.t("View deployed models")}
                                                        </button>
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
                    <h2>
                        {l10n.t("Create a KAITO Workspace")} ({state.clusterName})
                    </h2>
                    <hr />
                    <div className={styles.subHeader}>
                        {l10n.t(
                            "To get your model up and running, you can either create a CRD file with 'Generate CRD' which you can then deploy using kubectl apply -f filename.yml, or to deploy a model with default settings, just click 'Deploy Workspace'. This will deploy a workspace with default settings. Learn more about deploying KAITO workspaces",
                        )}{" "}
                        <a
                            rel="noreferrer"
                            target="_blank"
                            href="https://github.com/Azure/kaito?tab=readme-ov-file#quick-start"
                        >
                            {l10n.t("here.")}
                        </a>
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
                                                                {l10n.t("Minimum GPU size:")}{" "}
                                                                <span className={styles.gray}>
                                                                    {details.minimumGpu}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                {l10n.t("Compatible Kaito Versions:")}{" "}
                                                                <span className={styles.gray}>
                                                                    {details.kaitoVersion}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                {l10n.t("Model source:")}{" "}
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
        </div>
    );
}

// exported function to be shared in other kaito-related webviews
export function generateKaitoYAML(model: string): { yaml: string | undefined; gpu: string | undefined } {
    model = model.startsWith("workspace-") ? model.replace("workspace-", "") : model;
    const allModelDetails = kaitoSupporterModel.modelDetails;
    // Helper function to fetch model details by name
    const getModelDetails = (modelName: string) => {
        return allModelDetails.find((model) => model.modelName === modelName);
    };
    const getStringOrEmpty = (value?: string): string => value ?? "";

    const modelDetails = getModelDetails(model);
    if (!modelDetails) {
        return { yaml: undefined, gpu: undefined };
    }
    const name = getStringOrEmpty(modelDetails?.modelName);
    const gpu = getStringOrEmpty(modelDetails?.minimumGpu);

    // Default application, metadata, and inference names
    let appName = name;
    const metadataName = name;
    let inferenceName = name;

    // Phi-3 Models follow a different naming pattern, this corrects for that
    if (name.startsWith("phi-3")) {
        if (name.startsWith("phi-3-5")) {
            appName = "phi-3-5";
            inferenceName = inferenceName.replace("phi-3-5", "phi-3.5");
        } else {
            appName = "phi-3";
        }
    } else if (name.startsWith("qwen-2-5")) {
        inferenceName = inferenceName.replace("qwen-2-5", "qwen2.5");
    } else if (name.startsWith("llama-3")) {
        inferenceName = inferenceName.replace("llama-3-1", "llama3.1");
    }

    const yaml = `apiVersion: kaito.sh/v1beta1
kind: Workspace
metadata:
  name: workspace-${metadataName}
resource:
  instanceType: "${gpu}"
  labelSelector:
    matchLabels:
      apps: ${appName}
inference:
  preset:
    name: ${inferenceName}`;
    // Passing along gpu specification for subsequent usage
    return { yaml, gpu };
}

// Used to display properly formatted age in the UI
export function convertMinutesToFormattedAge(minutes: number) {
    const days = Math.floor(minutes / (60 * 24));
    const hours = Math.floor((minutes % (60 * 24)) / 60);
    const remainingMinutes = minutes % 60;

    let ageString = "";
    if (days > 0) {
        ageString += `${days}d`;
    }
    if (hours > 0 || days > 0) {
        ageString += `${hours}h`;
    }
    if (days === 0 && hours <= 9 && remainingMinutes > 0) {
        ageString += `${remainingMinutes}m`;
    }

    return ageString || "0m";
}
