import { FormEvent, useEffect, ChangeEvent as InputChangeEvent } from "react";
import { InterfaceName, NodeName } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { ResourceSelector } from "../components/ResourceSelector";
import { Lazy, isLoaded } from "../utilities/lazy";
import { EventHandlers } from "../utilities/state";
import styles from "./TcpDump.module.css";
import { SpecificPodFilters } from "./filterScenarios/SpecificPodFilters";
import { TwoPodsFilters } from "./filterScenarios/TwoPodsFilters";
import { CaptureScenario, EventDef, NodeState, ReferenceData } from "./state";
import { EventHandlerFunc, loadCaptureInterfaces } from "./state/dataLoading";
import {
    ApplicationLayerProtocol,
    TransportLayerProtocol,
    applicationLayerProtocols,
    protocolMapping,
    transportLayerProtocols,
} from "./protocols";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface CaptureFiltersProps {
    captureNode: NodeName;
    nodeState: NodeState;
    referenceData: ReferenceData;
    eventHandlers: EventHandlers<EventDef>;
}

export function CaptureFilters(props: CaptureFiltersProps) {
    const updates: EventHandlerFunc[] = [];
    const { lazyCaptureInterfaces } = prepareData(props.nodeState, props.captureNode, updates);
    useEffect(() => {
        updates.map((fn) => fn(props.eventHandlers));
    });

    const filters = props.nodeState.currentCaptureFilters;
    const scenarioLabels: Record<CaptureScenario, string> = {
        SpecificPod: "Specific Pod",
        TwoPods: "Two Pods",
    };

    function handleInterfaceChange(interfaceName: string | null) {
        // Only need to change the `interface` filter.
        // Interface is not part of the pcap filter string, so that does not need updating.
        props.eventHandlers.onSetCaptureFilters({
            node: props.captureNode,
            filters: { ...filters, interface: interfaceName },
        });
    }

    function handleScenarioChange(scenario: CaptureScenario | null) {
        props.eventHandlers.onSetCaptureFilters({
            node: props.captureNode,
            filters: { ...filters, scenario },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handleAppLayerProtocolChange(appLayerProtocol: ApplicationLayerProtocol | null) {
        props.eventHandlers.onSetCaptureFilters({
            node: props.captureNode,
            filters: {
                ...filters,
                appLayerProtocol,
                port: appLayerProtocol !== null ? protocolMapping[appLayerProtocol].port : filters.port,
                transportLayerProtocol:
                    appLayerProtocol !== null
                        ? protocolMapping[appLayerProtocol].protocol
                        : filters.transportLayerProtocol,
            },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handlePortChange(event: InputChangeEvent<HTMLInputElement>): void {
        const port = event.currentTarget.value ? parseInt(event.currentTarget.value) : null;
        props.eventHandlers.onSetCaptureFilters({
            node: props.captureNode,
            filters: {
                ...filters,
                port,
            },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handleTransportLayerProtocolChange(transportLayerProtocol: TransportLayerProtocol | null) {
        props.eventHandlers.onSetCaptureFilters({
            node: props.captureNode,
            filters: {
                ...filters,
                transportLayerProtocol,
            },
        });
        props.eventHandlers.onRefreshPcapFilterString({ node: props.captureNode });
    }

    function handlePcapFilterStringChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        const pcapFilterString = input.value || null;
        props.eventHandlers.onSetCaptureFilters({
            node: props.captureNode,
            filters: { ...filters, pcapFilterString },
        });
    }

    return (
        <div className={styles.filterContent}>
            <label htmlFor="interface-input" className={styles.label}>
                Interface
            </label>
            <ResourceSelector<InterfaceName>
                id="interface-input"
                className={styles.controlDropdown}
                resources={lazyCaptureInterfaces}
                selectedItem={filters.interface}
                valueGetter={(i) => i}
                labelGetter={(i) => i}
                onSelect={handleInterfaceChange}
            />

            <label htmlFor="app-layer-protocol-input" className={styles.label}>
                App Layer Protocol
            </label>
            <ResourceSelector<ApplicationLayerProtocol>
                id="app-layer-protocol-input"
                className={styles.controlDropdown}
                resources={applicationLayerProtocols.map((p) => p as ApplicationLayerProtocol)}
                selectedItem={filters.appLayerProtocol}
                valueGetter={(p) => p}
                labelGetter={(p) => p}
                onSelect={handleAppLayerProtocolChange}
            />

            <label htmlFor="port-input" className={styles.label}>
                Port
            </label>
            <input
                id="port-input"
                className={styles.numberControl}
                type="number"
                required
                value={filters.port || ""}
                pattern="/^[0-9]*$"
                max={65535}
                onChange={handlePortChange}
            ></input>

            <label htmlFor="transport-layer-protocol-input" className={styles.label}>
                Transport Layer Protocol
            </label>
            <ResourceSelector<TransportLayerProtocol>
                id="transport-layer-protocol-input"
                className={styles.controlDropdown}
                resources={transportLayerProtocols.map((p) => p as TransportLayerProtocol)}
                selectedItem={filters.transportLayerProtocol}
                valueGetter={(p) => p}
                labelGetter={(p) => p}
                onSelect={handleTransportLayerProtocolChange}
            />

            <label htmlFor="capture-scenario-input" className={styles.label}>
                Capture Scenario
            </label>
            <ResourceSelector<CaptureScenario>
                id="capture-scenario-input"
                className={styles.controlDropdown}
                resources={Object.keys(filters.scenarioFilters) as CaptureScenario[]}
                selectedItem={filters.scenario}
                valueGetter={(s) => s.toString()}
                labelGetter={(s) => scenarioLabels[s]}
                onSelect={handleScenarioChange}
            />

            {props.nodeState.currentCaptureFilters.scenario &&
                getScenarioFilterComponent(props.nodeState.currentCaptureFilters.scenario)}

            <label htmlFor="pcap-filter-string-input" className={styles.label}>
                Pcap Filter
            </label>
            <input
                type="text"
                id="pcap-filter-string-input"
                className={styles.control}
                value={props.nodeState.currentCaptureFilters.pcapFilterString || ""}
                onInput={handlePcapFilterStringChange}
            />
        </div>
    );

    function getScenarioFilterComponent(scenario: CaptureScenario) {
        switch (scenario) {
            case "SpecificPod":
                return (
                    <SpecificPodFilters
                        captureNode={props.captureNode}
                        filter={props.nodeState.currentCaptureFilters.scenarioFilters["SpecificPod"]}
                        referenceData={props.referenceData}
                        eventHandlers={props.eventHandlers}
                    />
                );
            case "TwoPods":
                return (
                    <TwoPodsFilters
                        captureNode={props.captureNode}
                        filter={props.nodeState.currentCaptureFilters.scenarioFilters["TwoPods"]}
                        referenceData={props.referenceData}
                        eventHandlers={props.eventHandlers}
                    />
                );
        }
    }
}

type LocalData = {
    lazyCaptureInterfaces: Lazy<string[]>;
};

function prepareData(nodeState: NodeState, node: NodeName, updates: EventHandlerFunc[]): LocalData {
    if (!isLoaded(nodeState.captureInterfaces)) {
        loadCaptureInterfaces(nodeState, node, updates);
    }

    return {
        lazyCaptureInterfaces: nodeState.captureInterfaces,
    };
}
