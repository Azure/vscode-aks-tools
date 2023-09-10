import { VSCodeLink, VSCodePanelTab, VSCodePanelView, VSCodePanels } from "@vscode/webview-ui-toolkit/react";
import { Overview } from "./Overview";
import { Traces, TracesProps } from "./Traces";
import styles from "./InspektorGadget.module.css";
import { useEffect, useReducer } from "react";
import { getWebviewMessageContext } from "../utilities/vscode";
import { createState, updateState, userMessageHandler, vscodeMessageHandler } from "./helpers/state";
import { GadgetCategory } from "./helpers/gadgets/types";
import { isNotLoaded } from "../utilities/lazy";
import { InitialState, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { UserMsgDef } from "./helpers/userCommands";
import { getEventHandlers, getMessageHandler } from "../utilities/state";

export function InspektorGadget(_props: InitialState) {
    const vscode = getWebviewMessageContext<"gadget">();

    const [state, dispatch] = useReducer(updateState, createState());

    useEffect(() => {
        const msgHandler = getMessageHandler<ToWebViewMsgDef>(dispatch, vscodeMessageHandler);
        vscode.subscribeToMessages(msgHandler);
    });

    useEffect(() => {
        if (!state.initializationStarted) {
            dispatch({ command: "setInitializing" });
            vscode.postMessage({ command: "getVersionRequest", parameters: undefined });
        }

        if (isNotLoaded(state.nodes)) {
            dispatch({ command: "setNodesLoading" });
            vscode.postMessage({ command: "getNodesRequest", parameters: undefined });
        }

        if (isNotLoaded(state.resources)) {
            dispatch({ command: "setNamespacesLoading" });
            vscode.postMessage({ command: "getNamespacesRequest", parameters: undefined });
        }
    });

    const userMessageEventHandlers = getEventHandlers<UserMsgDef>(dispatch, userMessageHandler);

    function handleRequestTraceId(): number {
        userMessageEventHandlers.onIncrementTraceId();
        return state.nextTraceId;
    }

    function getTracesProps(category: GadgetCategory): TracesProps {
        const traces = state.allTraces.filter(t => t.category === category);
        return {
            category,
            traces,
            nodes: state.nodes,
            resources: state.resources,
            onRequestTraceId: handleRequestTraceId,
            userMessageHandlers: userMessageEventHandlers
        };
    }

    const isDeployed = state.version && state.version.server !== null;

    return (
    <>
        <h2>Inspektor Gadget</h2>
        <p>
            Inspektor Gadget provides a wide selection of BPF tools to dig deep into your Kubernetes cluster.
            <VSCodeLink href="https://www.inspektor-gadget.io/">&nbsp;Learn more</VSCodeLink>
        </p>

        <VSCodePanels aria-label="Inspektory Gadget functions">
            <VSCodePanelTab>OVERVIEW</VSCodePanelTab>
            {isDeployed && <VSCodePanelTab>TRACES</VSCodePanelTab>}
            {isDeployed && <VSCodePanelTab>TOP</VSCodePanelTab>}
            {isDeployed && <VSCodePanelTab>SNAPSHOTS</VSCodePanelTab>}
            {isDeployed && <VSCodePanelTab>PROFILE</VSCodePanelTab>}

            <VSCodePanelView className={styles.tab}><Overview status={state.overviewStatus} version={state.version} userMessageHandlers={userMessageEventHandlers} /></VSCodePanelView>
            {isDeployed && <VSCodePanelView className={styles.tab}><Traces {...getTracesProps("trace")} /></VSCodePanelView>}
            {isDeployed && <VSCodePanelView className={styles.tab}><Traces {...getTracesProps("top")} /></VSCodePanelView>}
            {isDeployed && <VSCodePanelView className={styles.tab}><Traces {...getTracesProps("snapshot")} /></VSCodePanelView>}
            {isDeployed && <VSCodePanelView className={styles.tab}><Traces {...getTracesProps("profile")} /></VSCodePanelView>}
        </VSCodePanels>
    </>
    );
}