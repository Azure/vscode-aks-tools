import { InterfaceName, NodeName } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { ResourceSelector } from "../components/ResourceSelector";
import { map as lazyMap } from "../utilities/lazy";
import { EventHandlers } from "../utilities/state";
import styles from "./TcpDump.module.css";
import { EventDef, NodeState, ReferenceData } from "./state";

export interface CaptureFiltersProps {
    node: NodeName;
    nodeState: NodeState;
    referenceData: ReferenceData;
    eventHandlers: EventHandlers<EventDef>;
}

export function CaptureFilters(props: CaptureFiltersProps) {
    const filters = props.nodeState.currentCaptureFilters;
    return (
        <div className={styles.content}>
            <label htmlFor="interface-input" className={styles.label}>
                Interface
            </label>
            <ResourceSelector<InterfaceName>
                id="interface-input"
                className={styles.controlDropdown}
                resources={props.nodeState.captureInterfaces}
                selectedItem={filters.interface}
                valueGetter={(i) => i}
                labelGetter={(i) => i}
                onSelect={(i) =>
                    props.eventHandlers.onSetCaptureFilters({
                        node: props.node,
                        filters: { ...filters, interface: i },
                    })
                }
            />

            <label htmlFor="source-node-input" className={styles.label}>
                Source Node
            </label>
            <ResourceSelector<NodeName>
                id="source-node-input"
                className={styles.controlDropdown}
                resources={lazyMap(props.referenceData.nodes, (nodes) => nodes.map((n) => n.node))}
                selectedItem={filters.source.node}
                valueGetter={(n) => n}
                labelGetter={(n) => n}
                onSelect={(n) =>
                    props.eventHandlers.onSetCaptureFilters({
                        node: props.node,
                        filters: { ...filters, source: { ...filters.source, node: n } },
                    })
                }
            />
        </div>
    );
}
