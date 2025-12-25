import { useEffect } from "react";
import { CreateClusterInput } from "./CreateClusterInput";
import { Success } from "./Success";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import { useStateManagement } from "../utilities/state";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";

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
                return <p>{l10n.t("Loading...")}</p>;
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
                console.log("Creating cluster");
                return (
                    <>
                        <h3>
                            {l10n.t("Creating Cluster")} {state.createParams?.name} {l10n.t("in")}{" "}
                            {state.createParams?.location}
                        </h3>
                        {state.deploymentPortalUrl && (
                            <p>
                                {l10n.t("Click")} <a href={state.deploymentPortalUrl}>{l10n.t("here")}</a>{" "}
                                {l10n.t("to view the deployment in the AzurePortal.")}
                            </p>
                        )}

                        <ProgressRing />
                    </>
                );
            case Stage.Failed:
                return (
                    <>
                        <h3>{l10n.t("Error Creating Cluster")}</h3>
                        <p>{state.message}</p>
                    </>
                );
            case Stage.Succeeded:
                return (
                    <Success
                        portalClusterUrl={state.createdCluster?.portalUrl || ""}
                        name={state.createParams?.name || ""}
                    />
                );
            default:
                throw new Error(`Unexpected stage ${state.stage}`);
        }
    }

    return (
        <>
            <h1>{l10n.t("Create AKS Cluster")}</h1>
            <label>
                {l10n.t("Subscription:")} {state.subscriptionName}
            </label>
            {getBody()}
        </>
    );
}
