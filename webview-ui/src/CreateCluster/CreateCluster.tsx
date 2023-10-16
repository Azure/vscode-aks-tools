import { useEffect } from "react";
import { CreateClusterInput } from "./CreateClusterInput";
import { getWebviewMessageContext } from "../utilities/vscode";
import { Success } from "./Success";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { Stage, stateUpdater } from "./helpers/state";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { getStateManagement } from "../utilities/state";

export function CreateCluster(initialState: InitialState) {
    const vscode = getWebviewMessageContext<"createCluster">();
    const {state, eventHandlers, vsCodeMessageHandlers} = getStateManagement(stateUpdater, initialState);

    useEffect(() => {
        if (state.stage === Stage.Uninitialized) {
            vscode.postMessage({command: "getLocationsRequest", parameters: undefined});
            vscode.postMessage({command: "getResourceGroupsRequest", parameters: undefined});
            eventHandlers.onSetInitializing();
        }

        vscode.subscribeToMessages(vsCodeMessageHandlers);
    });

    useEffect(() => {
        if (state.stage === Stage.Loading && state.locations !== null && state.resourceGroups !== null) {
            eventHandlers.onSetInitialized();
        }
    }, [state.stage, state.locations, state.resourceGroups]);

    function getBody() {
        switch (state.stage) {
            case Stage.Uninitialized:
            case Stage.Loading:
                return <p>Loading...</p>
            case Stage.CollectingInput:
                return <CreateClusterInput locations={state.locations!} resourceGroups={state.resourceGroups!} eventHandlers={eventHandlers} vscode={vscode} />;
            case Stage.Creating:
                return (
                <>
                    <h3>Creating Cluster {state.createParams!.name} in {state.createParams!.location}</h3>
                    <VSCodeProgressRing />
                </>
                )
            case Stage.Failed:
                return (
                <>
                    <h3>Error Creating Cluster</h3>
                    <p>{state.message}</p>
                </>
                );
            case Stage.Succeeded:
               return (
                    <Success
                        portalUrl={state.portalUrl}
                        portalReferrerContext={state.portalReferrerContext}
                        subscriptionId={state.subscriptionId}
                        resourceGroup={state.createParams!.resourceGroup.name}
                        name={state.createParams!.name}
                    />
                );
            default:
                throw new Error(`Unexpected stage ${state.stage}`);
        }
    }

    return (
        <>
            <h2>Create Cluster in {state.subscriptionName}</h2>
            {getBody()}
        </>
    );
}