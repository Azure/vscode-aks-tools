import { VSCodePanelTab, VSCodePanelView, VSCodePanels } from "@vscode/webview-ui-toolkit/react";
import { Overview } from "./Overview";
import { Traces, TracesProps } from "./Traces";
import styles from "./InspektorGadget.module.css";
import { useEffect } from "react";
import { GadgetCategory } from "./helpers/gadgets/types";
import { isNotLoaded } from "../utilities/lazy";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./helpers/state";

export function InspektorGadget(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        if (!state.initializationStarted) {
            eventHandlers.onSetInitializing();
            vscode.postGetVersionRequest();
        }

        if (isNotLoaded(state.nodes)) {
            eventHandlers.onSetNodesLoading();
            vscode.postGetNodesRequest();
        }

        if (isNotLoaded(state.resources)) {
            eventHandlers.onSetNamespacesLoading();
            vscode.postGetNamespacesRequest();
        }
    });

    function handleRequestTraceId(): number {
        eventHandlers.onIncrementTraceId();
        return state.nextTraceId;
    }

    function getTracesProps(category: GadgetCategory): TracesProps {
        const traces = state.allTraces.filter((t) => t.category === category);
        return {
            category,
            traces,
            nodes: state.nodes,
            resources: state.resources,
            onRequestTraceId: handleRequestTraceId,
            eventHandlers: eventHandlers,
        };
    }

    const isDeployed = state.version && state.version.server !== null;

    return (
        <>
            <h2>Inspektor Gadget</h2>
            <p>
                Inspektor Gadget provides a wide selection of BPF tools to dig deep into your Kubernetes cluster.
                <a href="https://www.inspektor-gadget.io/">&nbsp;Learn more</a>
            </p>

            <VSCodePanels aria-label="Inspektory Gadget functions">
                <VSCodePanelTab>OVERVIEW</VSCodePanelTab>
                {isDeployed && <VSCodePanelTab>TRACES</VSCodePanelTab>}
                {isDeployed && <VSCodePanelTab>TOP</VSCodePanelTab>}
                {isDeployed && <VSCodePanelTab>SNAPSHOTS</VSCodePanelTab>}
                {isDeployed && <VSCodePanelTab>PROFILE</VSCodePanelTab>}

                <VSCodePanelView className={styles.tab}>
                    <Overview status={state.overviewStatus} version={state.version} eventHandlers={eventHandlers} />
                </VSCodePanelView>
                {isDeployed && (
                    <VSCodePanelView className={styles.tab}>
                        <Traces {...getTracesProps("trace")} />
                    </VSCodePanelView>
                )}
                {isDeployed && (
                    <VSCodePanelView className={styles.tab}>
                        <Traces {...getTracesProps("top")} />
                    </VSCodePanelView>
                )}
                {isDeployed && (
                    <VSCodePanelView className={styles.tab}>
                        <Traces {...getTracesProps("snapshot")} />
                    </VSCodePanelView>
                )}
                {isDeployed && (
                    <VSCodePanelView className={styles.tab}>
                        <Traces {...getTracesProps("profile")} />
                    </VSCodePanelView>
                )}
            </VSCodePanels>
        </>
    );
}
