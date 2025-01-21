import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { CreateFleetInput } from "./CreateFleetInput";
import { useStateManagement } from "../utilities/state";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import { VSCodeLink, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

export function CreateFleet(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        if (state.stage === Stage.Uninitialized) {
            vscode.postGetLocationsRequest();
            vscode.postGetResourceGroupsRequest();
            eventHandlers.onSetInitializing(); // Set stage to Stage.Loading
        }
    });

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
                return <p>Loading...</p>;
            case Stage.CollectingInput:
                return (
                    <CreateFleetInput
                        locations={state.locations!}
                        resourceGroups={state.resourceGroups!}
                        eventHandlers={eventHandlers}
                        vscode={vscode}
                    />
                );
            case Stage.Creating:
                return (
                    <>
                        <h3>
                            Creating Fleet {state.createParams!.name} in {state.createParams!.location}
                        </h3>
                        <VSCodeProgressRing />
                    </>
                );
            case Stage.Failed:
                return (
                    <>
                        <h3>Error Creating Fleet</h3>
                        <p>{state.message}</p>
                    </>
                );
            case Stage.Succeeded:
                return (
                    <>
                        <h3>Fleet {state.createParams!.name} was created successfully</h3>
                        <p>
                            Click <VSCodeLink href={state.createdFleet?.portalUrl}>here</VSCodeLink> to view your fleet
                            in the Azure Portal.
                        </p>
                    </>
                );
        }
    }

    return (
        <>
            <h1>Create AKS Fleet Manager</h1>
            <label>Subscription: {state.subscriptionName}</label>
            {getBody()}
        </>
    );
}
