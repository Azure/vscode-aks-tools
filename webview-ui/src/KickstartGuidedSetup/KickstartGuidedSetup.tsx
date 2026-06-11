import * as l10n from "@vscode/l10n";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kickstartGuidedSetup";
import { useStateManagement } from "../utilities/state";
import { GuidedSetupInput } from "./GuidedSetupInput";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import styles from "./KickstartGuidedSetup.module.css";

export function KickstartGuidedSetup(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    function getBody() {
        switch (state.stage) {
            case Stage.CollectingInput:
                return (
                    <GuidedSetupInput
                        samples={state.samples}
                        workspaceIsEmpty={state.workspaceIsEmpty}
                        errorMessage={state.errorMessage}
                        eventHandlers={eventHandlers}
                        vscode={vscode}
                    />
                );
            case Stage.Finishing:
                return <p>{l10n.t("Opening the Kickstart chat with your selections…")}</p>;
        }
    }

    return (
        <div className={styles.page}>
            <h1>{l10n.t("AKS Kickstart")}</h1>
            <p>
                {l10n.t("Describe the app you want to build, then continue in chat to set up your cluster and deploy.")}
            </p>
            {getBody()}
        </div>
    );
}
