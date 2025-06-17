import { Overview } from "./Overview";
import { Traces, TracesProps } from "./Traces";
import styles from "./InspektorGadget.module.css";
import { useEffect, useState } from "react";
import { GadgetCategory } from "./helpers/gadgets/types";
import { isNotLoaded } from "../utilities/lazy";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./helpers/state";
import * as l10n from "@vscode/l10n";
export function InspektorGadget(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);
    const [hasInitialResource, setHasInitialResource] = useState<boolean>(!!initialState.initialGadgetResource);

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

    function handleResourceUsed(): void {
        if (hasInitialResource) {
            setHasInitialResource(false);
            eventHandlers.onResetInitialGadgetResource();
        }
    }

    function getTracesProps(category: GadgetCategory): TracesProps {
        const traces = state.allTraces.filter((t) => t.category === category);
        // Only pass initialGadgetResource if we still have one to use and the category matches
        const initialGadgetResource =
            hasInitialResource && category === initialState.initialGadgetCategory && initialState.initialGadgetResource
                ? initialState.initialGadgetResource
                : undefined;

        return {
            category,
            traces,
            nodes: state.nodes,
            resources: state.resources,
            onRequestTraceId: handleRequestTraceId,
            eventHandlers: eventHandlers,
            initialGadgetResource,
            onResourceUsed: handleResourceUsed,
        };
    }

    const isDeployed = state.version && state.version.server !== null;

    // used to track active tab, initialized from props if provided
    const [activeTab, setActiveTab] = useState(initialState.initialActiveTab || "overview");

    return (
        <>
            <h2>{l10n.t("Inspektor Gadget")}</h2>
            <p>
                {l10n.t(
                    "Inspektor Gadget provides a wide selection of BPF tools to dig deep into your Kubernetes cluster.",
                )}
                <a href="https://www.inspektor-gadget.io/">&nbsp;{l10n.t("Learn more")}</a>
            </p>

            {/* implementation of tabs */}
            <div className={styles.tabContainer}>
                <div className={styles.tabHeader}>
                    <div
                        className={`${styles.tabItem} ${activeTab === "overview" ? styles.active : ""}`}
                        onClick={() => setActiveTab("overview")}
                    >
                        {l10n.t("OVERVIEW")}
                    </div>
                    {isDeployed && (
                        <>
                            <div
                                className={`${styles.tabItem} ${activeTab === "trace" ? styles.active : ""}`}
                                onClick={() => setActiveTab("trace")}
                            >
                                {l10n.t("TRACES")}
                            </div>
                            <div
                                className={`${styles.tabItem} ${activeTab === "top" ? styles.active : ""}`}
                                onClick={() => setActiveTab("top")}
                            >
                                {l10n.t("TOP")}
                            </div>
                            <div
                                className={`${styles.tabItem} ${activeTab === "snapshot" ? styles.active : ""}`}
                                onClick={() => setActiveTab("snapshot")}
                            >
                                {l10n.t("SNAPSHOTS")}
                            </div>
                            <div
                                className={`${styles.tabItem} ${activeTab === "profile" ? styles.active : ""}`}
                                onClick={() => setActiveTab("profile")}
                            >
                                {l10n.t("PROFILE")}
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
