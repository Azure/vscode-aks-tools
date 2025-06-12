import styles from "./InspektorGadget.module.css";
import { Dialog } from "../components/Dialog";
import { FormEvent, useEffect, useState, ChangeEvent as InputChangeEvent } from "react";
import { ResourceSelector } from "./ResourceSelector";
import { ClusterResources, Nodes } from "./helpers/clusterResources";
import { isLoaded, isNotLoaded } from "../utilities/lazy";
import { TraceItemSortSelector } from "./TraceItemSortSelector";
import { GadgetConfiguration, configuredGadgetResources, getGadgetMetadata } from "./helpers/gadgets";
import { GadgetSelector } from "./GadgetSelector";
import { NodeSelector } from "../components/NodeSelector";
import { GadgetCategory, GadgetExtraProperties, SortSpecifier, toExtraPropertyObject } from "./helpers/gadgets/types";
import { NamespaceSelection } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { EventHandlers } from "../utilities/state";
import { EventDef, vscode } from "./helpers/state";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";
const defaultTimeoutInSeconds = 30;
const defaultMaxItemCount = 20;

export interface NewTraceDialogProps {
    isShown: boolean;
    gadgetCategory: GadgetCategory;
    nodes: Nodes;
    resources: ClusterResources;
    eventHandlers: EventHandlers<EventDef>;
    onCancel: () => void;
    onAccept: (trace: GadgetConfiguration) => void;
    initialGadgetResource?: string;
}

export function NewTraceDialog(props: NewTraceDialogProps) {
    useEffect(() => {
        if (props.isShown && isNotLoaded(props.nodes)) {
            props.eventHandlers.onSetNodesLoading();
            vscode.postGetNodesRequest();
        }
        if (props.isShown && isNotLoaded(props.resources)) {
            props.eventHandlers.onSetNamespacesLoading();
            vscode.postGetNamespacesRequest();
        }
    });

    const [traceConfig, setTraceConfig] = useState<GadgetConfiguration>({
        category: props.gadgetCategory,
        resource: props.initialGadgetResource || "",
        filters: {
            namespace: NamespaceSelection.All,
        },
        displayProperties: [],
        sortSpecifiers: [],
        excludeThreads: undefined,
        timeout: undefined,
        maxItemCount: undefined,
    });

    const configuredResources = configuredGadgetResources[props.gadgetCategory];
    const metadata = traceConfig.resource ? getGadgetMetadata(props.gadgetCategory, traceConfig.resource) : null;
    const extraProperties = toExtraPropertyObject(metadata?.extraProperties ?? GadgetExtraProperties.None);

    function onResourceChanged(resource: string | null) {
        const metadata = (resource && configuredResources[resource]) || null;
        const extraProperties = toExtraPropertyObject(metadata?.extraProperties ?? GadgetExtraProperties.None);

        const displayProperties = metadata?.defaultProperties || [];
        const sortSpecifiers = metadata?.defaultSort || [];
        const maxItemCount = extraProperties.requiresMaxItemCount
            ? traceConfig.maxItemCount || defaultMaxItemCount
            : undefined;
        const excludeThreads = extraProperties.threadExclusionAllowed ? true : undefined;
        const timeout = extraProperties.requiresTimeout ? traceConfig.timeout || defaultTimeoutInSeconds : undefined;
        const { namespace, podName, containerName, ...rest } = traceConfig.filters!;
        const filters = extraProperties.noK8sResourceFiltering
            ? { ...rest, namespace: NamespaceSelection.Default }
            : traceConfig.filters;

        setTraceConfig({
            ...traceConfig,
            resource: resource || "",
            filters,
            displayProperties,
            sortSpecifiers,
            excludeThreads,
            maxItemCount,
            timeout,
        });
    }

    // Initialize with the initial resource if provided
    useEffect(() => {
        if (props.isShown && props.initialGadgetResource && !traceConfig.resource) {
            onResourceChanged(props.initialGadgetResource);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.isShown, props.initialGadgetResource, traceConfig.resource]);

    function handleNodeChanged(node: string | null) {
        const filters = { ...traceConfig.filters, nodeName: node || undefined };
        setTraceConfig({ ...traceConfig, filters });
    }

    function handleResourceSelectionChanged(selection: {
        namespace?: string;
        podName?: string;
        containerName?: string;
    }) {
        const { namespace, podName, containerName, ...rest } = traceConfig.filters!;
        const newNamespace = extraProperties.noK8sResourceFiltering
            ? NamespaceSelection.Default
            : !namespace
              ? NamespaceSelection.All
              : namespace;
        const filters = { ...rest, ...selection, namespace: newNamespace };
        setTraceConfig({ ...traceConfig, filters });
    }

    function canCreate(): boolean {
        const hasTimeoutIfRequired = !extraProperties.requiresTimeout || !!traceConfig.timeout;
        const hasMaxItemCountIfRequired = !extraProperties.requiresMaxItemCount || !!traceConfig.maxItemCount;
        return !!traceConfig.resource && hasTimeoutIfRequired && hasMaxItemCountIfRequired;
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!canCreate()) {
            return;
        }

        props.onAccept(traceConfig);

        // TODO: Make this an on-demand refresh, not on every submit.
        props.eventHandlers.onSetNodesNotLoaded();
        props.eventHandlers.onSetNamespacesNotLoaded();
    }

    function handleSortSpecifiersChange(sortSpecifiers: SortSpecifier<string>[]): void {
        setTraceConfig({ ...traceConfig, sortSpecifiers });
    }

    function handleDisplayThreadsChange(e: Event | FormEvent<HTMLElement>): void {
        const elem = e.target as HTMLInputElement;
        const excludeThreads = !elem.checked;
        setTraceConfig({ ...traceConfig, excludeThreads });
    }

    function handleTimeoutChange(event: InputChangeEvent<HTMLInputElement>): void {
        setTraceConfig({ ...traceConfig, timeout: parseInt(event.currentTarget.value) });
    }

    function handleMaxRowsChange(event: InputChangeEvent<HTMLInputElement>): void {
        setTraceConfig({ ...traceConfig, maxItemCount: parseInt(event.currentTarget.value) });
    }

    return (
        <Dialog isShown={props.isShown} onCancel={() => props.onCancel()}>
            <h2>{l10n.t("New Trace")}</h2>

            <form onSubmit={handleSubmit}>
                <hr />

                <div className={styles.inputContainer}>
                    <label htmlFor="gadget-dropdown" className={styles.label}>
                        Gadget
                    </label>
                    <GadgetSelector
                        id="gadget-dropdown"
                        className={styles.control}
                        required
                        category={props.gadgetCategory}
                        initialValue={props.initialGadgetResource}
                        onResourceChanged={onResourceChanged}
                    />

                    <label htmlFor="node-dropdown" className={styles.label}>
                        {l10n.t("Node")}
                    </label>
                    {isLoaded(props.nodes) ? (
                        <NodeSelector
                            nodes={props.nodes.value}
                            onNodeChanged={handleNodeChanged}
                            id="node-dropdown"
                            className={styles.control}
                        />
                    ) : (
                        <ProgressRing />
                    )}

                    {!extraProperties.noK8sResourceFiltering && (
                        <>
                            <label htmlFor="resource-selector" className={styles.label}>
                                {l10n.t("Resource")}
                            </label>
                            {isLoaded(props.resources) ? (
                                <ResourceSelector
                                    id="resource-selector"
                                    resources={props.resources.value}
                                    onSelectionChanged={handleResourceSelectionChanged}
                                    userMessageHandlers={props.eventHandlers}
                                />
                            ) : (
                                <ProgressRing />
                            )}
                        </>
                    )}

                    {extraProperties.sortingAllowed && (
                        <>
                            <label htmlFor="sort-selector" className={styles.label}>
                                {l10n.t("Sort by")}
                            </label>
                            <TraceItemSortSelector
                                id="sort-selector"
                                className={styles.control}
                                required={true}
                                allProperties={metadata?.allProperties || []}
                                sortSpecifiers={traceConfig.sortSpecifiers || []}
                                onSortSpecifiersChange={handleSortSpecifiersChange}
                            />
                        </>
                    )}

                    {extraProperties.requiresMaxItemCount && (
                        <>
                            <label htmlFor="max-rows-input" className={styles.label}>
                                {l10n.t("Max rows")}
                            </label>
                            <input
                                id="max-rows-input"
                                className={styles.control}
                                type="number"
                                required
                                value={traceConfig.maxItemCount}
                                min={1}
                                max={1000}
                                onChange={handleMaxRowsChange}
                            ></input>
                        </>
                    )}

                    {extraProperties.threadExclusionAllowed && (
                        <div>
                            <input
                                className={styles.displayCheckbox}
                                type="checkbox"
                                onChange={handleDisplayThreadsChange}
                            />
                            <label className={styles.displayLabel}>{l10n.t("Display Threads")}</label>
                        </div>
                    )}

                    {extraProperties.requiresTimeout && (
                        <>
                            <label htmlFor="timeout-input" className={styles.label}>
                                {l10n.t("Timeout")} (s)
                            </label>
                            <input
                                id="timeout-input"
                                className={styles.control}
                                type="number"
                                required
                                value={traceConfig.timeout}
                                min={1}
                                max={60 * 5}
                                onChange={handleTimeoutChange}
                            ></input>
                        </>
                    )}
                </div>

                <hr />

                <div className={styles.buttonContainer}>
                    <button type="submit" disabled={!canCreate()}>
                        {l10n.t("Ok")}
                    </button>
                    <button onClick={props.onCancel}>Cancel</button>
                </div>
            </form>
        </Dialog>
    );
}
