import { useStateManagement } from "../utilities/state";
import styles from "./KaitoManage.module.css";
import { stateUpdater, vscode } from "./state";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";
import { VSCodeDivider, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { generateKaitoYAML } from "../KaitoModels/KaitoModels";
import { useEffect } from "react";
import { convertMinutesToFormattedAge } from "../KaitoModels/KaitoModels";

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

    async function deleteWorkspace(model: string) {
        vscode.postDeleteWorkspaceRequest({ model: model });
    }
    async function redeployWorkspace(modelName: string, modelYaml: string) {
        vscode.postRedeployWorkspaceRequest({ modelName: modelName, modelYaml: modelYaml });
    }

    function testWorkspace(modelName: string) {
        vscode.postTestWorkspaceRequest({ modelName: modelName });
    }

    return (
        <>
            <h2 className={styles.mainTitle}>Manage KAITO Deployments ({state.clusterName})</h2>
            <VSCodeDivider />
            <p>
                Review the deployment status and perform operations on models in your cluster. If no clusters are shown,
                you must first deploy a model.
            </p>

            <div className={styles.gridContainer}>
                {state.models.map((model, index) => (
                    <div key={index} className={styles.gridItem}>
                        <p className={styles.modelName}>{model.name}</p>
                        <p className={styles.blurb}>
                            Review the status of each model deployment and access available actions as needed.
                            Deployment times vary greatly depending on model size.
                        </p>
                        <div className={styles.progressDiv}>
                            {!(model.workspaceReady ?? false) &&
                                (() => {
                                    if (model.age < 300 || model.resourceReady) {
                                        return (
                                            <>
                                                <div className={styles.buttonDiv}>
                                                    <button
                                                        onClick={() => deleteWorkspace(model.name)}
                                                        className={styles.button}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={() => getLogs()}
                                                        className={`${styles.button} ${styles.logButton}`}
                                                    >
                                                        Get Logs
                                                    </button>
                                                </div>
                                                <VSCodeProgressRing className={styles.progress} />
                                                <span className={styles.bold}>Deployment in progress</span>
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
                                                        )
                                                    }
                                                    className={`${styles.button} ${styles.redeployButton}`}
                                                >
                                                    Re-deploy default CRD
                                                </button>
                                                <button
                                                    onClick={() => deleteWorkspace(model.name)}
                                                    className={styles.button}
                                                >
                                                    Delete Workspace
                                                </button>
                                                <button
                                                    onClick={() => getLogs()}
                                                    className={`${styles.button} ${styles.logButton}`}
                                                >
                                                    Get Logs
                                                </button>
                                            </div>
                                            <div className={styles.sucessContainer}>
                                                <div className={styles.successIconContainer}>
                                                    <i className={`codicon codicon-error ${styles.errorIcon}`}></i>
                                                </div>
                                                <span className={styles.successMessage}>Failed Deployment</span>
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
                                                        onClick={() => deleteWorkspace(model.name)}
                                                    >
                                                        Delete Workspace
                                                    </button>
                                                    <button
                                                        onClick={() => getLogs()}
                                                        className={`${styles.button} ${styles.logButton}`}
                                                    >
                                                        Get Logs
                                                    </button>
                                                    <button
                                                        className={`${styles.button} ${styles.testButton}`}
                                                        onClick={() => testWorkspace(model.name)}
                                                    >
                                                        Test
                                                    </button>
                                                </div>
                                                <div className={styles.successIconContainer}>
                                                    <i className={`codicon codicon-pass ${styles.successIcon}`}></i>
                                                </div>
                                                <span className={styles.successMessage}>Deployment successful</span>
                                            </div>
                                        </>
                                    );
                                })()}
                        </div>
                        <div className={styles.statusTable}>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>Name</span>
                                <span className={styles.gray}>
                                    workspace-
                                    {model.name}
                                </span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>Instance</span>
                                <span className={styles.gray}>{model.instance}</span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>Resource Ready</span>
                                <span className={styles.gray}>
                                    {model.resourceReady === null
                                        ? "In-progress"
                                        : model.resourceReady
                                          ? "True"
                                          : "False"}
                                </span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>Inference Ready</span>
                                <span className={styles.gray}>
                                    {model.inferenceReady === null
                                        ? "In-progress"
                                        : model.inferenceReady
                                          ? "True"
                                          : "False"}
                                </span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>Workspace Ready</span>
                                <span className={styles.gray}>
                                    {model.workspaceReady === null
                                        ? "In-progress"
                                        : model.workspaceReady
                                          ? "True"
                                          : "False"}
                                </span>
                            </div>
                            <div className={styles.statusRow}>
                                <span className={styles.statusLabel}>Age</span>
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
