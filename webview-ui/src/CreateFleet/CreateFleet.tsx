import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { CreateFleetInput } from "./CreateFleetInput";
import { useStateManagement } from "../utilities/state";
import { Stage, stateUpdater, vscode } from "./helpers/state";
// import { CreateFleetState, Stage } from "./helpers/state";

export function CreateFleet(initialState: InitialState) {
    // const state: CreateFleetState = {
    //     stage: Stage.CollectingInput, // hardcoded
    //     subscriptionId: initialState.subscriptionId,
    //     subscriptionName: initialState.subscriptionName,
    // };
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);
    // should be removed once dynamic user input is implemented
    state.locations = ["au east", "au southeast"];
    state.resourceGroups = [
        { name: "rg1", location: "au east" },
        { name: "rg2", location: "au southeast" },
    ];

    useEffect(() => {
        if (state.stage === Stage.Uninitialized) {
            vscode.postGetLocationsRequest();
            vscode.postGetResourceGroupsRequest();
            eventHandlers.onSetInitializing();
        }
    });

    useEffect(() => {
        if (state.stage === Stage.Loading && state.locations !== null && state.resourceGroups !== null) {
            eventHandlers.onSetInitialized();
        }
    }, [state.stage, state.locations, state.resourceGroups, eventHandlers]);

    function getBody() {
        // switch (state.stage) {
        //     case Stage.Uninitialized:
        //     case Stage.Loading:
        //         return <p>Loading...</p>;
        //     case Stage.CollectingInput:
        //         return (
        //             <CreateFleetInput
        //                 locations={state.locations!}
        //                 resourceGroups={state.resourceGroups!}
        //                 eventHandlers={eventHandlers}
        //                 vscode={vscode}
        //             />
        //         );
        // }
        return (
            <CreateFleetInput
                locations={state.locations!}
                resourceGroups={state.resourceGroups!}
                eventHandlers={eventHandlers}
                vscode={vscode}
            />
        );
    }

    return (
        <>
            <h1>Create AKS Fleet Manager</h1>
            <label>Subscription: hardcoded AKS Long Running Things</label>
            <p>Initial State: {JSON.stringify(initialState)}</p>
            {getBody()}
        </>
    );
}
