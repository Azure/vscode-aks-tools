import { GadgetCategory } from "./helpers/gadgets/types";
import { configuredGadgetResources } from "./helpers/gadgets";
import { CustomDropdown } from "../components/CustomDropdown";
import { CustomDropdownOption } from "../components/CustomDropdownOption";
import { useState } from "react";
export interface GadgetSelectorProps {
    category: GadgetCategory;
    id: string;
    className?: string;
    required?: boolean;
    onResourceChanged: (resource: string | null) => void;
}

export function GadgetSelector(props: GadgetSelectorProps) {
    function handleResourceChange(value: string) {
        const resource = value ? value : null;
        setSelectedNode(value);
        props.onResourceChanged(resource);
    }

    const configuredResources = configuredGadgetResources[props.category];
    const [selectedNode, setSelectedNode] = useState<string>("");

    return (
        <CustomDropdown id={props.id} className={props.className} value={selectedNode} onChange={handleResourceChange}>
            <CustomDropdownOption value="" label="Select" />
            {Object.keys(configuredResources).map((resource) => (
                <CustomDropdownOption key={resource} value={resource} label={configuredResources[resource]!.name} />
            ))}
        </CustomDropdown>
    );
}
