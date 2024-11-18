import { VSCodeButton, VSCodeProgressRing, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { InitialState, ProgressEventType } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { useStateManagement } from "../utilities/state";
import styles from "./Kaito.module.css";
import kaitoimage from "./kaito-image.png";
import { useState } from "react";

import { stateUpdater, vscode } from "./state";
export function Kaito(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);
    const [isDisabled, setIsDisabled] = useState(false);

    const handleClick = () => {
        onClickKaitoInstall();
        setIsDisabled(true); // Disable the button after click
    };

    function onClickKaitoInstall() {
        vscode.postInstallKaitoRequest();
    }

    function onClickGenerateWorkspace() {
        vscode.postGenerateWorkspaceRequest();
    }

    return (
        <>
            <div className={styles.container}>
                <h2>Kubernetes AI Toolchain Operator (KAITO) - {state.clusterName}</h2>
                <VSCodeDivider />
                <div className={styles.subHeader}>
                    Using KAITO, the workflow of onboarding and deploying large AI inference models on your cluster is
                    largely simplified. KAITO manages large model files using container images and hosts them in the
                    public Microsoft Container Registry (MCR) if the license allows.
                </div>
                <h3 className={styles.architecture}>Architecture</h3>
                <div className={styles.architectureSubHeader}>
                    KAITO follows the classic Kubernetes Custom Resource Definition(CRD)/controller design pattern. User
                    manages a workspace custom resource which describes the GPU requirements and the inference or tuning
                    specification. Kaito controllers will automate the deployment by reconciling the workspace custom
                    resource.
                </div>
                <div>
                    <img src={kaitoimage} alt="kaitoimage" className={styles.kaitoImage} />
                </div>
                <div className={styles.lastContent}>
                    <ul>
                        <li>
                            KAITO presets the model configurations to avoid adjusting workload parameters based on GPU
                            hardware.
                        </li>
                        <li>Auto-provisions cost-effective GPU nodes based on model requirements.</li>
                        <li>KAITO provides an HTTP server to perform inference calls using the model library.</li>
                        <p className={styles.installBlurb}>
                            (By pressing install, you will install the managed KAITO addon. To read the official
                            documentation, click{" "}
                            <a
                                className={styles.link}
                                href="https://learn.microsoft.com/en-us/azure/aks/ai-toolchain-operator"
                            >
                                here.
                            </a>
                            )
                        </p>
                    </ul>
                </div>
                <div>
                    {state.kaitoInstallStatus === ProgressEventType.NotStarted && (
                        <button className={styles.button} onClick={handleClick} disabled={isDisabled}>
                            Install KAITO
                        </button>
                    )}
                    {state.kaitoInstallStatus === ProgressEventType.InProgress &&
                        state.operationDescription.includes("Installing KAITO") && (
                            <div
                                style={{
                                    flexDirection: "row",
                                    display: "flex",
                                }}
                            >
                                <VSCodeProgressRing />
                                <p className={styles.installingMessage}>
                                    Installing KAITO, this may take a few minutes...
                                </p>
                            </div>
                        )}
                    {state.kaitoInstallStatus === ProgressEventType.InProgress &&
                        state.operationDescription.includes("KAITO Federated Credentials and role Assignments") && (
                            <div
                                style={{
                                    flexDirection: "row",
                                    display: "flex",
                                }}
                            >
                                <VSCodeProgressRing />
                                <p className={styles.installingMessage}>
                                    Enabling Role assignments and Federated Credentails for KAITO, this may take a few
                                    minutes...
                                </p>
                            </div>
                        )}
                    {state.kaitoInstallStatus === ProgressEventType.Success && state.models.length > 0 && (
                        <div className={styles.postInstall}>
                            <p>KAITO is installed!</p>
                            <p className={styles.thin}>You can now create a workspace by clicking the button below.</p>
                            <div>
                                {" "}
                                <VSCodeButton className={styles.generateButton} onClick={onClickGenerateWorkspace}>
                                    Generate Workspace
                                </VSCodeButton>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
