import { useStateManagement } from "../utilities/state";
import styles from "./KaitoManage.module.css";
import { stateUpdater, vscode } from "./state";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";
import { generateKaitoYAML } from "../KaitoModels/KaitoModels";
import { useEffect } from "react";
import { convertMinutesToFormattedAge } from "../KaitoModels/KaitoModels";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";

export function KaitoManage(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);
    // updates workspace status
    async function updateStatus() {
        vscode.postMonitorUpdateRequest({});
    }
    // retrieves & outputs logs
    async function getLogs() {
        vscode.postGetLogsRequest({});
    }
    // polls workspace status every 5 seconds
    useEffect(() => {
        const intervalId = setInterval(() => {
            updateStatus();
        }, 5000);
        return () => clearInterval(intervalId);
    });

    async function deleteWorkspace(model: string, namespace: string) {
        vscode.postDeleteWorkspaceRequest({ model: model.replace(".", "-"), namespace: namespace });
    }
    async function redeployWorkspace(modelName: string, modelYaml: string | undefined, namespace: string) {
        vscode.postRedeployWorkspaceRequest({ modelName: modelName, modelYaml: modelYaml, namespace: namespace });
    }

    function testWorkspace(modelName: string, namespace: string) {
        vscode.postTestWorkspaceRequest({ modelName: modelName, namespace: namespace });
    }

    function portForward(modelName: string, namespace: string) {
        vscode.postPortForwardRequest({ modelName: modelName, namespace: namespace });
    }

    return (
        <>
            <h2 className={styles.mainTitle}>
                {l10n.t("Manage KAITO Deployments")} ({state.clusterName})
            </h2>
            <hr />
            <p>
                {l10n.t(
                    "Review the deployment status and perform operations on models in your cluster. If no clusters are shown, you must first deploy a model.",
                )}
            </p>

            <div className={styles.gridContainer}>
                {state.models.map((model, index) => (
                    <div key={index} className={styles.gridItem}>
                        <p className={styles.modelName}>{model.name}</p>
                        <p className={styles.blurb}>
                            {l10n.t(
                                "Review the status of each model deployment and access available actions as needed. Deployment times vary greatly depending on model size.",
                            )}
                        </p>
                        <div className={styles.progressDiv}>
                            {!(model.workspaceReady ?? false) &&
                                (() => {
                                    if (model.age < 300 || model.resourceReady) {
                                        return (
                                            <>
                                                <div className={styles.buttonDiv}>
                                                    <button
                                                        onClick={() => deleteWorkspace(model.name, model.namespace)}
                                                        className={styles.button}
                                                    >
                                                        {l10n.t("Cancel")}
                                                    </button>
                                                    <button
                                                        onClick={() => getLogs()}
                                                        className={`${styles.button} ${styles.logButton}`}
                                                    >
                                                        {l10n.t("Get Logs")}
                                                    </button>
                                                </div>
                                                <ProgressRing className={styles.progress} />
                                                <span className={styles.bold}>{l10n.t("Deployment in progress")}</span>
                                            </>
                                        );
                                    }
                                    return (
                                        <>
                                            <div className={styles.buttonDiv}>
                                                <button
                                                    onClick={() =>
                                                        redeployWorkspace(
                                                            model.name,
                                                            generateKaitoYAML(model.name).yaml,
                                                            model.namespace,
                                                        )
                                                    }
                                                    className={`${styles.button} ${styles.redeployButton}`}
                                                >
                                                    {l10n.t("Re-deploy default CRD")}
                                                </button>
                                                <button
                                                    onClick={() => deleteWorkspace(model.name, model.namespace)}
                                                    className={styles.button}
                                                >
                                                    {l10n.t("Delete Workspace")}
                                                </button>
                                                <button
                                                    onClick={() => getLogs()}
                                                    className={`${styles.button} ${styles.logButton}`}
                                                >
                                                    {l10n.t("Get Logs")}
                                                </button>
                                            </div>
                                            <div className={styles.sucessContainer}>
                                                <div className={styles.successIconContainer}>
                                                    <i className={`codicon codicon-error ${styles.errorIcon}`}></i>
                                                </div>
                                                <span className={styles.successMessage}>
                                                    {l10n.t("Failed Deployment")}
                                                </span>
                                            </div>
                                        </>
                                    );
                                })()}
                            {(model.workspaceReady ?? false) &&
                                (() => {
                                    return (
                                        <>
                                            <div className={styles.sucessContainer}>
                                                <div className={styles.buttonDiv}>
                                                    <button
                                                        className={styles.button}
                                                        onClick={() => deleteWorkspace(model.name, model.namespace)}
                                                    >
                                                        {l10n.t("Delete Workspace")}
                                                    </button>
                                                    <button
                                                        onClick={() => getLogs()}
                                                        className={`${styles.button} ${styles.logButton}`}
                                                    >
                                                        {l10n.t("Get Logs")}
                                                    </button>
                                                    <button
                                                        className={`${styles.button} ${styles.testButton}`}
                                                        onClick={() => testWorkspace(model.name, model.namespace)}
                                                    >
                                                        {l10n.t("Test")}
                                                    </button>
                                                    <button
                                                        className={`${styles.button} ${styles.testButton}`}
                                                        onClick={() => portForward(model.name, model.namespace)}
                                                    >
                                                        {l10n.t("Port-Forward")}
                                                    </button>
                                                </div>
                                                <div className={styles.successIconContainer}>
                                                    <i className={`codicon codicon-pass ${styles.successIcon}`}></i>
                                                </div>
                                                <span className={styles.successMessage}>
                                                    {l10n.t("Deployment successful")}
                                                </span>
                                            </div>
                                        </>
                                    );
                                })()}
                        </div>
                        <div className={styles.statusTable}>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>{l10n.t("Name")}</span>
                                <span className={styles.gray}>{model.name}</span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>{l10n.t("Instance")}</span>
                                <span className={styles.gray}>{model.instance}</span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>{l10n.t("Resource Ready")}</span>
                                <span className={styles.gray}>
                                    {model.resourceReady === null
                                        ? "In-progress"
                                        : model.resourceReady
                                          ? "True"
                                          : "False"}
                                </span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>{l10n.t("Inference Ready")}</span>
                                <span className={styles.gray}>
                                    {model.inferenceReady === null
                                        ? "In-progress"
                                        : model.inferenceReady
                                          ? "True"
                                          : "False"}
                                </span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>{l10n.t("Workspace Ready")}</span>
                                <span className={styles.gray}>
                                    {model.workspaceReady === null
                                        ? "In-progress"
                                        : model.workspaceReady
                                          ? "True"
                                          : "False"}
                                </span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>{l10n.t("Age")}</span>
                                <span className={styles.gray}>{convertMinutesToFormattedAge(model.age)}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {void state}
        </>
    );
}
