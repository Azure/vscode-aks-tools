import * as l10n from "@vscode/l10n";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kickstartGuidedSetup";
import { useStateManagement } from "../utilities/state";
import { GuidedSetupInput } from "./GuidedSetupInput";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import styles from "./KickstartGuidedSetup.module.css";

export function KickstartGuidedSetup(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    return (
        <div className={styles.page}>
            <h1>{l10n.t("AKS Kickstart")}</h1>
            <p>
                {l10n.t("Describe the app you want to build, then continue in chat to set up your cluster and deploy.")}
            </p>
            {/* The form stays mounted while finishing so a failed handoff returns the user to their
                selections instead of an empty form. */}
            <GuidedSetupInput
                samples={state.samples}
                workspaceIsEmpty={state.workspaceIsEmpty}
                errorMessage={state.errorMessage}
                githubRepos={state.githubRepos}
                githubReposLoading={state.githubReposLoading}
                githubReposError={state.githubReposError}
                githubSignedInUser={state.githubSignedInUser}
                githubReposTruncated={state.githubReposTruncated}
                githubNeedsSignIn={state.githubNeedsSignIn}
                isFinishing={state.stage === Stage.Finishing}
                eventHandlers={eventHandlers}
                vscode={vscode}
            />
        </div>
    );
}
