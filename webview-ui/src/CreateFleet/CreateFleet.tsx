import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { CreateFleetInput } from "./CreateFleetInput";
import { useStateManagement } from "../utilities/state";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";
export function CreateFleet(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        if (state.stage === Stage.Uninitialized) {
            vscode.postGetLocationsRequest();
            vscode.postGetResourceGroupsRequest();
            eventHandlers.onSetInitializing(); // Set stage to Stage.Loading
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (state.stage === Stage.Loading && state.locations !== null && state.resourceGroups !== null) {
            eventHandlers.onSetInitialized(); // Set stage to Stage.CollectingInput
        }
    }, [state.stage, state.locations, state.resourceGroups, eventHandlers]);

    function getBody() {
        // Returns JSX based on the current stage
        switch (state.stage) {
            case Stage.Uninitialized:
            case Stage.Loading:
                return <p>{l10n.t("Loading...")}</p>;
            case Stage.CollectingInput:
                return (
                    <CreateFleetInput
                        locations={state.locations!}
                        resourceGroups={state.resourceGroups!}
                        subscriptionId={state.subscriptionId}
                        eventHandlers={eventHandlers}
                        vscode={vscode}
                    />
                );
            case Stage.Creating:
                return (
                    <>
                        <h3>
                            {l10n.t("Creating Fleet")} {state.createParams!.name} {l10n.t("in")}{" "}
                            {state.createParams!.location}
                        </h3>
                        <ProgressRing />
                    </>
                );
            case Stage.Failed:
                return (
                    <>
                        <h3>{l10n.t("Error Creating Fleet")}</h3>
                        <p>{state.message}</p>
                    </>
                );
            case Stage.Succeeded:
                return (
                    <>
                        <h3>
                            {l10n.t("Fleet")} {state.createParams!.name} {l10n.t("was created successfully")}
                        </h3>
                        <p>
                            {l10n.t("Click")} <a href={state.createdFleet?.portalUrl}>{l10n.t("here")}</a>{" "}
                            {l10n.t("to view your fleet in the Azure Portal.")}
                        </p>
                    </>
                );
        }
    }

    return (
        <>
            <h1>{l10n.t("Create AKS Fleet Manager")}</h1>
            <label>
                {l10n.t("Subscription:")} {state.subscriptionName}
            </label>
            {getBody()}
        </>
    );
}
