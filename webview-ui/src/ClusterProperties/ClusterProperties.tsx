import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { getStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";
import { ClusterDisplay } from "./ClusterDisplay";
import { isLoaded, isNotLoaded } from "../utilities/lazy";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { AgentPoolDisplay } from "./AgentPoolDisplay";

export function ClusterProperties(initialState: InitialState) {
    const {state, eventHandlers, vsCodeMessageHandlers} = getStateManagement(stateUpdater, initialState);

    useEffect(() => {
        vscode.subscribeToMessages(vsCodeMessageHandlers);
    }, []);

    useEffect(() => {
        if (isNotLoaded(state.clusterInfo)) {
            vscode.postGetPropertiesRequest();
            eventHandlers.onSetPropertiesLoading();
        }
    });

    return (
    <>
        <h2>AKS Cluster Properties of {state.clusterName}</h2>
        {isLoaded(state.clusterInfo) ?
            <ClusterDisplay clusterInfo={state.clusterInfo.value} clusterOperationRequested={state.clusterOperationRequested} eventHandlers={eventHandlers} /> :
            <VSCodeProgressRing />
        }

        {isLoaded(state.clusterInfo) && state.clusterInfo.value.agentPoolProfiles.map(ap => (
            <>
                <h3>Agent Pool: {ap.name}</h3>
                <AgentPoolDisplay profileInfo={ap} />
            </>
        ))}
    </>
    );
}