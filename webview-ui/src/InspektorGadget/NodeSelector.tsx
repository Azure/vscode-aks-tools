import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { FormEvent } from "react";

export interface NodeSelectorProps {
    nodes: string[]
    id: string
    className: React.HTMLAttributes<any>['className']
    required?: boolean
    onNodeChanged: (node: string | null) => void
}

export function NodeSelector(props: NodeSelectorProps) {
    function handleNodeChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.target as HTMLInputElement;
        const node = elem.value || null;
        props.onNodeChanged(node);
    }

    return (
        <VSCodeDropdown id={props.id} className={props.className} required={props.required} onChange={handleNodeChange}>
            <VSCodeOption value="">Select</VSCodeOption>
            {props.nodes.map(node => (
                <VSCodeOption key={node} value={node}>{node}</VSCodeOption>
            ))}
        </VSCodeDropdown>
    );
}