import { EventHandlers } from "../../utilities/state";
import { EventDef, ReferenceData, SingleEndpointPacketDirection, SpecificPodFilter } from "../state";
import { ResourceSelector } from "../../components/ResourceSelector";
import { Lazy, isLoaded, newLoading } from "../../utilities/lazy";
import styles from "../TcpDump.module.css";
import { FilterPod, NodeName } from "../../../../src/webview-contract/webviewDefinitions/tcpDump";
import { EventHandlerFunc, loadAllNodes, loadFilterPods } from "../state/dataLoading";
import { FormEvent, useEffect } from "react";
import { getOrThrow } from "../../utilities/array";
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";

export interface SpecificPodFiltersProps {
    captureNode: NodeName;
    filter: SpecificPodFilter;
    referenceData: ReferenceData;
    eventHandlers: EventHandlers<EventDef>;
}

export function SpecificPodFilters(props: SpecificPodFiltersProps) {
    const updates: EventHandlerFunc[] = [];
    const { lazyPods } = prepareData(props.referenceData, props.captureNode, updates);
    useEffect(() => {
        updates.map((fn) => fn(props.eventHandlers));
    });

    function handlePodChange(pod: FilterPod | null) {
        props.eventHandlers.onSetCaptureScenarioFilters({
            node: props.captureNode,
            scenario: "SpecificPod",
            filters: { ...props.filter, pod },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handlePacketDirectionChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.target as HTMLInputElement;
        const packetDirection = elem.value as SingleEndpointPacketDirection;
        props.eventHandlers.onSetCaptureScenarioFilters({
            node: props.captureNode,
            scenario: "SpecificPod",
            filters: { ...props.filter, packetDirection },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    const packetDirectionLabels: Record<SingleEndpointPacketDirection, string> = {
        SentAndReceived: "Sent and received",
        Sent: "Sent only",
        Received: "Received only",
    };

    return (
        <>
            <label htmlFor="filter-pod-input" className={styles.label}>
                Pod
            </label>
            <ResourceSelector<FilterPod>
                id="filter-pod-input"
                className={styles.controlDropdown}
                resources={lazyPods}
                selectedItem={props.filter.pod}
                valueGetter={(p) => p.name}
                labelGetter={(p) => p.name}
                onSelect={handlePodChange}
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
                        {packetDirectionLabels[d as SingleEndpointPacketDirection]}
                    </VSCodeOption>
                ))}
            </VSCodeDropdown>
        </>
    );
}

type LocalData = {
    lazyPods: Lazy<FilterPod[]>;
};

function prepareData(referenceData: ReferenceData, captureNode: NodeName, updates: EventHandlerFunc[]): LocalData {
    const returnValue: LocalData = {
        lazyPods: newLoading(),
    };

    if (!isLoaded(referenceData.nodes)) {
        loadAllNodes(referenceData, updates);
        return returnValue;
    }

    const nodesReferenceData = referenceData.nodes.value;
    const nodeReferenceData = getOrThrow(nodesReferenceData, (n) => n.node === captureNode, `${captureNode} not found`);

    if (!isLoaded(nodeReferenceData.filterPods)) {
        loadFilterPods(nodeReferenceData, updates);
        return returnValue;
    }

    returnValue.lazyPods = nodeReferenceData.filterPods;
    return returnValue;
}
