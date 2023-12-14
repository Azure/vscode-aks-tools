import { EventHandlers } from "../../utilities/state";
import { DualEndpointPacketDirection, EventDef, ReferenceData, TwoPodsFilter } from "../state";
import { ResourceSelector } from "../../components/ResourceSelector";
import { Lazy, isLoaded, newLoaded, newLoading } from "../../utilities/lazy";
import styles from "../TcpDump.module.css";
import { FilterPod, NodeName } from "../../../../src/webview-contract/webviewDefinitions/tcpDump";
import { EventHandlerFunc, loadAllNodes, loadFilterPods } from "../state/dataLoading";
import { getOrThrow } from "../../utilities/array";
import { FormEvent, useEffect } from "react";
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";

export interface TwoPodsFiltersProps {
    captureNode: NodeName;
    filter: TwoPodsFilter;
    eventHandlers: EventHandlers<EventDef>;
    referenceData: ReferenceData;
}

export function TwoPodsFilters(props: TwoPodsFiltersProps) {
    const updates: EventHandlerFunc[] = [];
    const { lazySourceNodes, lazySourcePods, lazyDestNodes, lazyDestPods } = prepareData(
        props.referenceData,
        props.filter,
        updates,
    );

    useEffect(() => {
        updates.map((fn) => fn(props.eventHandlers));
    });

    function handleSourceNodeChange(node: NodeName | null) {
        props.eventHandlers.onSetCaptureScenarioFilters({
            node: props.captureNode,
            scenario: "TwoPods",
            filters: { ...props.filter, sourceNode: node, sourcePod: null },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handleSourcePodChange(pod: FilterPod | null) {
        props.eventHandlers.onSetCaptureScenarioFilters({
            node: props.captureNode,
            scenario: "TwoPods",
            filters: { ...props.filter, sourcePod: pod },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handleDestNodeChange(node: NodeName | null) {
        props.eventHandlers.onSetCaptureScenarioFilters({
            node: props.captureNode,
            scenario: "TwoPods",
            filters: { ...props.filter, destNode: node, destPod: null },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handleDestPodChange(pod: FilterPod | null) {
        props.eventHandlers.onSetCaptureScenarioFilters({
            node: props.captureNode,
            scenario: "TwoPods",
            filters: { ...props.filter, destPod: pod },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handlePacketDirectionChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.target as HTMLInputElement;
        const packetDirection = elem.value as DualEndpointPacketDirection;
        props.eventHandlers.onSetCaptureScenarioFilters({
            node: props.captureNode,
            scenario: "TwoPods",
            filters: { ...props.filter, packetDirection },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    const packetDirectionLabels: Record<DualEndpointPacketDirection, string> = {
        Bidirectional: "Bidirectional",
        SourceToDestination: "Source to destination",
    };

    return (
        <>
            <label htmlFor="source-node-input" className={styles.label}>
                Source Node
            </label>
            <ResourceSelector<NodeName>
                id="source-node-input"
                className={styles.controlDropdown}
                resources={lazySourceNodes}
                selectedItem={props.filter.sourceNode}
                valueGetter={(n) => n}
                labelGetter={(n) => n}
                onSelect={handleSourceNodeChange}
            />

            <label htmlFor="source-pod-input" className={styles.label}>
                Source Pod
            </label>
            <ResourceSelector<FilterPod>
                id="source-pod-input"
                className={styles.controlDropdown}
                resources={lazySourcePods}
                selectedItem={props.filter.sourcePod}
                valueGetter={(p) => p.name}
                labelGetter={(p) => p.name}
                onSelect={handleSourcePodChange}
            />

            <label htmlFor="dest-node-input" className={styles.label}>
                Destination Node
            </label>
            <ResourceSelector<NodeName>
                id="dest-node-input"
                className={styles.controlDropdown}
                resources={lazyDestNodes}
                selectedItem={props.filter.destNode}
                valueGetter={(n) => n}
                labelGetter={(n) => n}
                onSelect={handleDestNodeChange}
            />

            <label htmlFor="dest-pod-input" className={styles.label}>
                Destination Pod
            </label>
            <ResourceSelector<FilterPod>
                id="dest-pod-input"
                className={styles.controlDropdown}
                resources={lazyDestPods}
                selectedItem={props.filter.destPod}
                valueGetter={(p) => p.name}
                labelGetter={(p) => p.name}
                onSelect={handleDestPodChange}
            />

            <label htmlFor="packet-direction-input" className={styles.label}>
                Packet Direction
            </label>
            <VSCodeDropdown
                className={styles.controlDropdown}
                id="packet-direction-input"
                value={props.filter.packetDirection}
                onChange={handlePacketDirectionChange}
            >
                {Object.keys(packetDirectionLabels).map((d) => (
                    <VSCodeOption key={d} value={d}>
                        {packetDirectionLabels[d as DualEndpointPacketDirection]}
                    </VSCodeOption>
                ))}
            </VSCodeDropdown>
        </>
    );
}

type LocalData = {
    lazySourceNodes: Lazy<NodeName[]>;
    lazySourcePods: Lazy<FilterPod[]>;
    lazyDestNodes: Lazy<NodeName[]>;
    lazyDestPods: Lazy<FilterPod[]>;
};

function prepareData(referenceData: ReferenceData, filter: TwoPodsFilter, updates: EventHandlerFunc[]): LocalData {
    const returnValue: LocalData = {
        lazySourceNodes: newLoading(),
        lazySourcePods: newLoading(),
        lazyDestNodes: newLoading(),
        lazyDestPods: newLoading(),
    };

    if (!isLoaded(referenceData.nodes)) {
        loadAllNodes(referenceData, updates);
        return returnValue;
    }

    const nodesData = referenceData.nodes.value;
    returnValue.lazySourceNodes = newLoaded(nodesData.map((d) => d.node));
    returnValue.lazyDestNodes = newLoaded(nodesData.map((d) => d.node));

    if (filter.sourceNode) {
        const nodeData = getOrThrow(nodesData, (n) => n.node === filter.sourceNode, `${filter.sourceNode} not found`);
        if (!isLoaded(nodeData.filterPods)) {
            loadFilterPods(nodeData, updates);
        } else {
            returnValue.lazySourcePods = nodeData.filterPods;
        }
    }

    if (filter.destNode) {
        const nodeData = getOrThrow(nodesData, (n) => n.node === filter.destNode, `${filter.destNode} not found`);
        if (!isLoaded(nodeData.filterPods)) {
            loadFilterPods(nodeData, updates);
        } else {
            returnValue.lazyDestPods = nodeData.filterPods;
        }
    }

    return returnValue;
}
