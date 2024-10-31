import { useStateManagement } from "../utilities/state";
import styles from "./KaitoManage.module.css";
import { stateUpdater, vscode } from "./state";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";
import { VSCodeDivider, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

export function KaitoManage(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);

    async function startChecking() {
        vscode.postMonitorUpdateRequest({ models: state.models });
    }
    // async function stopChecking() {
    //     vscode.postStopCheckingRequest({ models: state.models });
    // }
    async function deleteWorkspace(model: string) {
        vscode.postDeleteWorkspaceRequest({ model: model });
    }

    return (
        <>
            <h2 className={styles.mainTitle}>Manage Kaito Deployments</h2>
            <VSCodeDivider />
            <button onClick={startChecking}>Start</button>
            {/* <button onClick={stopChecking}>Stop</button> */}

            <p>Review models that you have generated custom resource documents and deployment status.</p>

            <div className={styles.gridContainer}>
                {state.models.map((model, index) => (
                    <div key={index} className={styles.gridItem}>
                        <p className={styles.modelName}>{model.name}</p>
                        <p className={styles.blurb}>
                            If this is your preferred model for deployment in your application, please proceed to
                            generate the custom resource document and initiate the deployment process.
                        </p>
                        <div className={styles.progressDiv}>
                            {!(model.workspaceReady ?? false) &&
                                (() => {
                                    if (model.age < 200 || model.resourceReady) {
                                        return (
                                            <>
                                                <div className={styles.buttonDiv}>
                                                    <button
                                                        onClick={() => deleteWorkspace(model.name)}
                                                        className={styles.button}
                                                    >
                                                        Cancel
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
                                                <button className={`${styles.button} ${styles.testButton}`}>
                                                    Re-deploy default CRD
                                                </button>
                                                <button
                                                    onClick={() => deleteWorkspace(model.name)}
                                                    className={styles.button}
                                                >
                                                    Delete Workspace
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
                                                    <button className={`${styles.button} ${styles.testButton}`}>
                                                        Test
                                                    </button>
                                                    <button className={styles.button}>Delete Workspace</button>
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
                                <span className={styles.gray}>{model.age}m</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {void state}
        </>
    );
}
