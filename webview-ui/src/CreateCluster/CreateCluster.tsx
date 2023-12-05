import { useEffect } from "react";
import { CreateClusterInput } from "./CreateClusterInput";
import { Success } from "./Success";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import { VSCodeLink, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { useStateManagement } from "../utilities/state";

export function CreateCluster(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

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
        switch (state.stage) {
            case Stage.Uninitialized:
            case Stage.Loading:
                return <p>Loading...</p>;
            case Stage.CollectingInput:
                return (
                    <CreateClusterInput
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
                            Creating Cluster {state.createParams!.name} in {state.createParams!.location}
                        </h3>
                        {state.deploymentPortalUrl && (
                            <p>
                                Click <VSCodeLink href={state.deploymentPortalUrl}>here</VSCodeLink> to view the
                                deployment in the Azure Portal.
                            </p>
                        )}

                        <VSCodeProgressRing />
                    </>
                );
            case Stage.Failed:
                return (
                    <>
                        <h3>Error Creating Cluster</h3>
                        <p>{state.message}</p>
                    </>
                );
            case Stage.Succeeded:
                return (
                    <Success portalClusterUrl={state.createdCluster?.portalUrl || ""} name={state.createParams!.name} />
                );
            default:
                throw new Error(`Unexpected stage ${state.stage}`);
        }
    }

    return (
        <>
            <h1>Create Cluster</h1>
            <label>Subscription: {state.subscriptionName}</label>
            {getBody()}
        </>
    );
}
