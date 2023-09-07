import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { FormEvent } from "react";
import { GadgetCategory } from "./helpers/gadgets/types";
import { configuredGadgetResources } from "./helpers/gadgets";

export interface GadgetSelectorProps {
    category: GadgetCategory
    id: string
    className: React.HTMLAttributes<any>['className']
    required?: boolean
    onResourceChanged: (resource: string | null) => void
}

export function GadgetSelector(props: GadgetSelectorProps) {
    function handleResourceChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.target as HTMLInputElement;
        const resource = elem.value ? elem.value : null;
        props.onResourceChanged(resource);
    }

    const configuredResources = configuredGadgetResources[props.category];

    return (
        <VSCodeDropdown id={props.id} className={props.className} required={props.required} onChange={handleResourceChange}>
            <VSCodeOption value="">Select</VSCodeOption>
            {Object.keys(configuredResources).map(resource => (
                <VSCodeOption key={resource} value={resource}>{configuredResources[resource]!.name}</VSCodeOption>
            ))}
        </VSCodeDropdown>
    );
}