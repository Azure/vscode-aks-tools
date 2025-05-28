import { InitialState } from "../../../src/webview-contract/webviewDefinitions/headlamp";
import { vscode, stateUpdater } from "./state";
import { useStateManagement } from "../utilities/state";
import { ProgressRing } from "../components/ProgressRing";
import styles from "./Headlamp.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRocket, faKey, faPlay, faStop } from "@fortawesome/free-solid-svg-icons";

export function Headlamp(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);

    function onclickDeployHeadlamp() {
        vscode.postDeployHeadlampRequest();
    }
    function onclickGenerateToken() {
        vscode.postGenerateTokenRequest();
    }
    function onclickStartPortForwarding() {
        vscode.postStartPortForwardingRequest();
    }
    function onclickStopPortForwarding() {
        vscode.postStopPortForwardingRequest();
    }

    return (
        <div>
            <h2>Headlamp</h2>
            <p>Manage Headlamp deployment, port forwarding, and token generation for easy cluster access.</p>
            <hr />
            <br />
            {state.deploymentStatus === "undeployed" && (
                <>
                    <button onClick={onclickDeployHeadlamp}>
                        <FontAwesomeIcon icon={faRocket} />
                        &nbsp;&nbsp;Deploy Headlamp{" "}
                    </button>
                </>
            )}

            {state.deploymentStatus === "deploying" && (
                <>
                    <div>
                        <h3 className={styles.deployingHeader}>Deploying Headlamp... </h3>
                        <ProgressRing className={styles.progressRing} />
                    </div>
                </>
            )}

            {state.deploymentStatus === "deployed" && (
                <>
                    <h3> Headlamp is deployed! </h3>
                    <button onClick={onclickStartPortForwarding}>
                        <FontAwesomeIcon icon={faPlay} />
                        &nbsp;&nbsp;Begin Port Forwarding
                    </button>
                    <br />
                    <br />
                    <button onClick={onclickStopPortForwarding}>
                        <FontAwesomeIcon icon={faStop} />
                        &nbsp;&nbsp;Stop Port Forwarding
                    </button>
                    <br />
                    <br />
                    <br />
                    <br />
                    <button onClick={onclickGenerateToken}>
                        <FontAwesomeIcon icon={faKey} />
                        &nbsp;&nbsp;Generate Token
                    </button>
                    <br />
                    <br />
                    {/* <p> {state.token} </p> */}

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <input
                            type="text"
                            readOnly
                            value={state.token}
                            title={state.token} // optional: shows full token on hover
                            className={styles.tokenInput}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(state.token);
                                alert("Token copied!");
                            }}
                        >
                            Copy
                        </button>
                    </div>
                </>
            )}

            <br />
        </div>
    );
}
