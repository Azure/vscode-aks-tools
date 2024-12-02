import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import styles from "./InspektorGadget.module.css";
import { TraceGadget } from "./helpers/gadgets";
import { ProcessSnapshotKey } from "./helpers/gadgets/snapshot";
import { ItemProperty, ValueType } from "./helpers/gadgets/types";

export interface TraceOutputProps {
    trace: TraceGadget;
}

export function TraceOutput(props: TraceOutputProps) {
    const tidKey: ProcessSnapshotKey = "tid";
    const outputProperties = props.trace.displayProperties.filter(
        (p) => !props.trace?.excludeThreads || p.key !== tidKey,
    );
    const outputArrays = props.trace.output?.map((item) =>
        outputProperties.map((p) => ({ property: p, value: item[p.key] })),
    );
    if (props.trace.output === null) {
        return (
            <>
                <VSCodeProgressRing></VSCodeProgressRing>
                Running Gadget...
            </>
        );
    }

    return (
        <table className={styles.traceoutput}>
            <thead>
                <tr>
                    {outputProperties.map((p) => (
                        <th key={p.name}>{p.name}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {outputArrays &&
                    outputArrays.map((values, i) => (
                        <tr key={i}>
                            {values.map((val, i) => (
                                <td key={i}>{displayValue(val.value, val.property)}</td>
                            ))}
                        </tr>
                    ))}
            </tbody>
        </table>
    );
}

function displayValue(value: unknown, property: ItemProperty<string>) {
    switch (property.valueType) {
        case ValueType.CharByte:
            return <>{String.fromCharCode(value as number)}</>;
        case ValueType.Bytes:
            return <>{String(value ?? "")} B</>;
        case ValueType.StackTrace:
            return <pre>{value as string}</pre>;
        case ValueType.AddressArray:
            return <>{value ? (JSON.parse(value as string) as string[]).join(",") : ""}</>;
        case ValueType.Timestamp:
            return <>{value ? formatTime(value as number) : ""}</>;
        default:
            return <>{String(value ?? "")}</>;
    }
}

function formatTime(timestampInNs: number): string {
    const date = new Date(timestampInNs / 1000000);
    const msFraction = timestampInNs % 1000000;
    return `${date.toISOString().slice(0, -1) + msFraction.toString()}Z`;
}
