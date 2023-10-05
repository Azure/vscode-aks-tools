import { useEffect, useReducer } from "react";
import { CreateClusterInput } from "./CreateClusterInput";
import { getWebviewMessageContext } from "../utilities/vscode";
import { Success } from "./Success";
import { InitialState, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { Stage, createState, updateState, userMessageHandler, vscodeMessageHandler } from "./helpers/state";
import { getEventHandlers, getMessageHandler } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

export function CreateCluster(props: InitialState) {
    const vscode = getWebviewMessageContext<"createCluster">();

    const [state, dispatch] = useReducer(updateState, createState());

    const userMessageEventHandlers = getEventHandlers<UserMsgDef>(dispatch, userMessageHandler);

    useEffect(() => {
        if (state.stage === Stage.Uninitialized) {
            vscode.postMessage({command: "getLocationsRequest", parameters: undefined});
            vscode.postMessage({command: "getResourceGroupsRequest", parameters: undefined});
            userMessageEventHandlers.onSetInitializing();
        }

        const msgHandler = getMessageHandler<ToWebViewMsgDef>(dispatch, vscodeMessageHandler);
        vscode.subscribeToMessages(msgHandler);
    });

    useEffect(() => {
        if (state.stage === Stage.Loading && state.locations !== null && state.resourceGroups !== null) {
            userMessageEventHandlers.onSetInitialized();
        }
    }, [state.stage, state.locations, state.resourceGroups]);

    function getBody() {
        switch (state.stage) {
            case Stage.Uninitialized:
            case Stage.Loading:
                return <p>Loading...</p>
            case Stage.CollectingInput:
                return <CreateClusterInput locations={state.locations!} resourceGroups={state.resourceGroups!} userMessageHandlers={userMessageEventHandlers} vscode={vscode} />;
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
                        portalUrl={props.portalUrl}
                        portalReferrerContext={props.portalReferrerContext}
                        subscriptionId={props.subscriptionId}
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
            <h2>Create Cluster in {props.subscriptionName}</h2>
            {getBody()}
        </>
    );
}