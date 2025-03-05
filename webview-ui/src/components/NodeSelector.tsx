import { CustomDropdown } from "./CustomDropdown";
import { CustomDropdownOption } from "./CustomDropdownOption";
import { useState } from "react";

export interface NodeSelectorProps {
    nodes: string[];
    id: string;
    className?: string;
    required?: boolean;
    onNodeChanged: (node: string | null) => void;
}

export function NodeSelector(props: NodeSelectorProps) {
    const [selectedNode, setSelectedNode] = useState<string>("");

    function handleNodeChange(node: string) {
        setSelectedNode(node);
        props.onNodeChanged(node);
    }

    return (
        <CustomDropdown id={props.id} value={selectedNode} className={props.className} onChange={handleNodeChange}>
            <CustomDropdownOption value="" label="Select" />
            {props.nodes.map((node) => (
                <CustomDropdownOption key={node} value={node} label={node} />
            ))}
        </CustomDropdown>
    );
}
