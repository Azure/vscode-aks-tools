import { Overview } from "./Overview";
import { Traces, TracesProps } from "./Traces";
import styles from "./InspektorGadget.module.css";
import { useEffect, useState } from "react";
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

    // used to track active tab
    const [activeTab, setActiveTab] = useState("overview");

    return (
        <>
            <h2>Inspektor Gadget</h2>
            <p>
                Inspektor Gadget provides a wide selection of BPF tools to dig deep into your Kubernetes cluster.
                <a href="https://www.inspektor-gadget.io/">&nbsp;Learn more</a>
            </p>

            {/* implementation of tabs */}
            <div className={styles.tabContainer}>
                <div className={styles.tabHeader}>
                    <div
                        className={`${styles.tabItem} ${activeTab === "overview" ? styles.active : ""}`}
                        onClick={() => setActiveTab("overview")}
                    >
                        OVERVIEW
                    </div>
                    {isDeployed && (
                        <>
                            <div
                                className={`${styles.tabItem} ${activeTab === "trace" ? styles.active : ""}`}
                                onClick={() => setActiveTab("trace")}
                            >
                                TRACES
                            </div>
                            <div
                                className={`${styles.tabItem} ${activeTab === "top" ? styles.active : ""}`}
                                onClick={() => setActiveTab("top")}
                            >
                                TOP
                            </div>
                            <div
                                className={`${styles.tabItem} ${activeTab === "snapshot" ? styles.active : ""}`}
                                onClick={() => setActiveTab("snapshot")}
                            >
                                SNAPSHOTS
                            </div>
                            <div
                                className={`${styles.tabItem} ${activeTab === "profile" ? styles.active : ""}`}
                                onClick={() => setActiveTab("profile")}
                            >
                                PROFILE
                            </div>
                        </>
                    )}
                </div>

                <div>
                    {activeTab === "overview" && (
                        <>
                            <Overview
                                status={state.overviewStatus}
                                version={state.version}
                                eventHandlers={eventHandlers}
                            />
                        </>
                    )}
                    {isDeployed && activeTab === "trace" && <Traces {...getTracesProps("trace")} />}
                    {isDeployed && activeTab === "top" && <Traces {...getTracesProps("top")} />}
                    {isDeployed && activeTab === "snapshot" && <Traces {...getTracesProps("snapshot")} />}
                    {isDeployed && activeTab === "profile" && <Traces {...getTracesProps("profile")} />}
                </div>
            </div>
        </>
    );
}
