import { useEffect } from "react";
import { CreateClusterInput } from "./CreateClusterInput";
import { Success } from "./Success";
import { InitialState, PresetType } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import { useStateManagement } from "../utilities/state";
import { ProgressRing } from "../components/ProgressRing";
import styles from "./CreateCluster.module.css";
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

    function getSummary() {
        if (!state.createParams || state.stage === Stage.CollectingInput) {
            return null;
        }

        const { name, resourceGroupName, location, preset } = state.createParams;
        return (
            <div className={styles.summary}>
                <span>
                    {l10n.t("Cluster name:")} {name}
                </span>
                <span>
                    {l10n.t("Resource group:")} {resourceGroupName}
                </span>
                <span>
                    {l10n.t("Region:")} {location}
                </span>
                <span>
                    {l10n.t("Preset:")}{" "}
                    {preset === PresetType.Automatic ? l10n.t("Automatic (preview)") : l10n.t("Dev/Test")}
                </span>
            </div>
        );
    }

    function getDeploymentLink() {
        return (
            state.deploymentPortalUrl && (
                <p>
                    {l10n.t("Click")} <a href={state.deploymentPortalUrl}>{l10n.t("here")}</a>{" "}
                    {l10n.t("to view the deployment in the AzurePortal.")}
                </p>
            )
        );
    }

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
                return (
                    <>
                        <h3>{l10n.t("Creating Cluster")}</h3>
                        {getDeploymentLink()}
                        <ProgressRing />
                    </>
                );
            case Stage.Failed:
                return (
                    <>
                        <h3>{l10n.t("Error Creating Cluster")}</h3>
                        <p>{state.message}</p>
                        {getDeploymentLink()}
                    </>
                );
            case Stage.TrackingLost:
                return (
                    <>
                        <h3>{l10n.t("Couldn't Get Cluster Creation Status")}</h3>
                        <p>{l10n.t("The deployment may still be running. Check its status in the Azure portal.")}</p>
                        <p>{state.message}</p>
                        {getDeploymentLink()}
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
            {getSummary()}
            {getBody()}
        </>
    );
}
