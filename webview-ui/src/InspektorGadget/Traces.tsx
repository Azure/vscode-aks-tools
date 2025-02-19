import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrashCan, faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import styles from "./InspektorGadget.module.css";
import { FormEvent, useState } from "react";
import { NewTraceDialog } from "./NewTraceDialog";
import { ClusterResources, Nodes } from "./helpers/clusterResources";
import { GadgetConfiguration, TraceGadget, getGadgetMetadata, toGadgetArguments } from "./helpers/gadgets";
import { GadgetCategory } from "./helpers/gadgets/types";
import { TraceOutput } from "./TraceOutput";
import { NamespaceFilter, NamespaceSelection } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { EventHandlers } from "../utilities/state";
import { EventDef, vscode } from "./helpers/state";

export interface TracesProps {
    category: GadgetCategory;
    traces: TraceGadget[];
    nodes: Nodes;
    resources: ClusterResources;
    onRequestTraceId: () => number;
    eventHandlers: EventHandlers<EventDef>;
}

const streamingCategories: GadgetCategory[] = ["top", "trace"];

export function Traces(props: TracesProps) {
    const [isNewTraceDialogShown, setIsTraceDialogShown] = useState(false);
    const [checkedTraceIds, setCheckedTraceIds] = useState<number[]>([]);
    const [selectedTraceId, setSelectedTraceId] = useState<number | null>(null);
    const [isWatching, setIsWatching] = useState<boolean>(false);
    const isStreamingTrace = streamingCategories.includes(props.category);

    function handleAdd() {
        setIsTraceDialogShown(true);
    }

    function ignoreClick(e: Event | FormEvent<HTMLElement>) {
        e.stopPropagation();
    }

    function toggleCheckedTraceId(traceId: number) {
        if (checkedTraceIds.includes(traceId)) {
            setCheckedTraceIds(checkedTraceIds.filter((id) => id !== traceId));
        } else {
            setCheckedTraceIds(checkedTraceIds.concat(traceId));
        }
    }

    function toggleIsWatching(trace: TraceGadget) {
        if (!isStreamingTrace) {
            return;
        }

        if (isWatching) {
            vscode.postStopStreamingTraceRequest();
        } else {
            vscode.postRunStreamingTraceRequest({ arguments: toGadgetArguments(trace), traceId: trace.traceId });
        }

        setIsWatching(!isWatching);
    }

    function handleDelete() {
        if (selectedTraceId !== null && checkedTraceIds.includes(selectedTraceId)) {
            if (isWatching && isStreamingTrace) {
                vscode.postStopStreamingTraceRequest();
            }

            setSelectedTraceId(null);
        }

        props.eventHandlers.onDeleteTraces({ traceIds: checkedTraceIds });
        setCheckedTraceIds([]);
    }

    function handleNewTraceDialogCancel() {
        setIsTraceDialogShown(false);
    }

    function handleNewTraceDialogAccept(traceConfig: GadgetConfiguration) {
        setIsTraceDialogShown(false);
        const gadgetArguments = toGadgetArguments(traceConfig);
        const traceId = props.onRequestTraceId();
        const trace: TraceGadget = { ...traceConfig, traceId, output: null };
        if (isStreamingTrace) {
            vscode.postRunStreamingTraceRequest({ arguments: gadgetArguments, traceId });
        } else {
            vscode.postRunBlockingTraceRequest({ arguments: gadgetArguments, traceId });
        }

        props.eventHandlers.onCreateTrace({ trace });
        setSelectedTraceId(traceId);

        if (isStreamingTrace) {
            setIsWatching(true);
        }
    }

    function getTraceRowClassNames(traceId?: number): string {
        return selectedTraceId === traceId ? styles.selected : "";
    }

    function handleRowClick(trace: TraceGadget) {
        if (isWatching && isStreamingTrace) {
            vscode.postStopStreamingTraceRequest();
        }

        const isNewTraceSelected = selectedTraceId !== trace.traceId;

        if (isWatching && isStreamingTrace && isNewTraceSelected) {
            const gadgetArguments = toGadgetArguments(trace);
            vscode.postRunStreamingTraceRequest({ arguments: gadgetArguments, traceId: trace.traceId });
        }

        setSelectedTraceId(isNewTraceSelected ? trace.traceId : null);
    }

    const selectedTrace = props.traces.find((t) => t.traceId === selectedTraceId) || null;
    const metadata = selectedTrace && getGadgetMetadata(selectedTrace.category, selectedTrace.resource);

    return (
        <>
            {props.traces.length > 0 && (
                <table className={styles.tracelist}>
                    <thead>
                        <tr>
                            <th>Gadget</th>
                            <th>Namespace</th>
                            <th>Node</th>
                            <th>Pod</th>
                            <th>Container</th>
                        </tr>
                    </thead>
                    <tbody>
                        {props.traces.map((trace) => (
                            <tr
                                key={trace.traceId}
                                onClick={() => handleRowClick(trace)}
                                className={getTraceRowClassNames(trace.traceId)}
                            >
                                <td>
                                    <input
                                        type="checkbox"
                                        onClick={ignoreClick}
                                        onChange={() => toggleCheckedTraceId(trace.traceId)}
                                        style={{ margin: "0 0.5rem 0 0" }}
                                    />
                                    <span className={styles.checkBoxLabel}>
                                        {getGadgetMetadata(trace.category, trace.resource)?.name}
                                    </span>
                                </td>
                                <td>{getNamespaceText(trace.filters.namespace)}</td>
                                <td>{trace.filters.nodeName}</td>
                                <td>{trace.filters.podName}</td>
                                <td>{trace.filters.containerName}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <div className={styles.buttonContainer}>
                <button onClick={handleAdd}>
                    <FontAwesomeIcon icon={faPlus} />
                    &nbsp;Add
                </button>
                {checkedTraceIds.length > 0 && (
                    <button onClick={handleDelete}>
                        <FontAwesomeIcon icon={faTrashCan} />
                        &nbsp;Delete
                    </button>
                )}
            </div>

            <hr />

            {selectedTrace && (
                <>
                    <h3>
                        {isStreamingTrace && (
                            <FontAwesomeIcon
                                icon={isWatching ? faEye : faEyeSlash}
                                onClick={() => toggleIsWatching(selectedTrace)}
                                style={{ cursor: "pointer", paddingRight: "0.5rem" }}
                            />
                        )}
                        {metadata?.name}
                    </h3>
                    <TraceOutput trace={selectedTrace} />
                </>
            )}

            <NewTraceDialog
                isShown={isNewTraceDialogShown}
                gadgetCategory={props.category}
                nodes={props.nodes}
                resources={props.resources}
                eventHandlers={props.eventHandlers}
                onCancel={handleNewTraceDialogCancel}
                onAccept={handleNewTraceDialogAccept}
            />
        </>
    );
}

function getNamespaceText(namespace: NamespaceFilter): string {
    return namespace === NamespaceSelection.Default ? "" : namespace === NamespaceSelection.All ? "All" : namespace;
}
