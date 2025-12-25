import { InitialState, ProgressEventType } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { useStateManagement } from "../utilities/state";
import styles from "./Kaito.module.css";
import kaitoimage from "./kaito-image.png";
import { useState } from "react";

import { stateUpdater, vscode } from "./state";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";
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
                <h2>
                    {l10n.t("Kubernetes AI Toolchain Operator (KAITO)")} - {state.clusterName}
                </h2>
                <hr />
                <div className={styles.subHeader}>
                    {l10n.t(
                        "Using KAITO, the workflow of onboarding and deploying large AI inference models on your cluster is largely simplified. KAITO manages large model files using container images and hosts them in the public Microsoft Container Registry (MCR) if the license allows.",
                    )}
                </div>
                <h3 className={styles.architecture}>{l10n.t("Architecture")}</h3>
                <div className={styles.architectureSubHeader}>
                    {l10n.t(
                        "KAITO follows the classic Kubernetes Custom Resource Definition(CRD)/controller design pattern. User manages a workspace custom resource which describes the GPU requirements and the inference or tuning specification. Kaito controllers will automate the deployment by reconciling the workspace custom resource.",
                    )}
                </div>
                <div>
                    <img src={kaitoimage} alt="kaitoimage" className={styles.kaitoImage} />
                </div>
                <div className={styles.lastContent}>
                    <ul>
                        <li>
                            {l10n.t(
                                "KAITO presets the model configurations to avoid adjusting workload parameters based on GPU hardware.",
                            )}
                        </li>
                        <li>{l10n.t("Auto-provisions cost-effective GPU nodes based on model requirements.")}</li>
                        <li>
                            {l10n.t(
                                "KAITO provides an HTTP server to perform inference calls using the model library.",
                            )}
                        </li>
                        <p className={styles.installBlurb}>
                            (
                            {l10n.t(
                                "By pressing install, you will install the managed KAITO addon. To read the official documentation, click",
                            )}{" "}
                            <a
                                className={styles.link}
                                href="https://learn.microsoft.com/en-us/azure/aks/ai-toolchain-operator"
                            >
                                {l10n.t("here.")}
                            </a>
                            )
                        </p>
                    </ul>
                </div>
                <div className={styles.installationDiv}>
                    {state.kaitoInstallStatus === ProgressEventType.NotStarted && (
                        <button className={styles.button} onClick={handleClick} disabled={isDisabled}>
                            {l10n.t("Install KAITO")}
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
                                <ProgressRing />
                                <p className={styles.installingMessage}>
                                    {l10n.t("Installing KAITO, this may take a few minutes...")}
                                </p>
                            </div>
                        )}
                    {state.kaitoInstallStatus === ProgressEventType.Success && (
                        <div className={styles.postInstall}>
                            <p>{l10n.t("KAITO is installed!")}</p>
                            <p className={styles.thin}>
                                {l10n.t("You can now create a workspace by clicking the button below.")}
                            </p>
                            <div>
                                {" "}
                                <button className={styles.generateButton} onClick={onClickGenerateWorkspace}>
                                    {l10n.t("Generate Workspace")}
                                </button>
                            </div>
                        </div>
                    )}
                    {state.kaitoInstallStatus === ProgressEventType.Failed && (
                        <div className={styles.postInstall}>
                            <p>{l10n.t("Error installing KAITO.")}</p>
                            <p className={styles.errorMessage}>{state.errors}</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
