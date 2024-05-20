import { FormEvent } from "react";
import { Lazy, asLazy, isLoaded, isLoading } from "../utilities/lazy";
import { VSCodeDropdown, VSCodeOption, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

export interface ResourceSelectorProps<TResource> {
    resources: Lazy<TResource[]> | TResource[];
    selectedItem: TResource | null;
    valueGetter: (resource: TResource) => string;
    labelGetter: (resource: TResource) => string;
    id?: string;
    className?: string;
    onSelect: (value: TResource | null) => void;
}

export function ResourceSelector<TResource>(props: ResourceSelectorProps<TResource>) {
    const resources = asLazy(props.resources);

    function handleChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.target as HTMLInputElement;
        const resource =
            elem.value && isLoaded(resources)
                ? resources.value.find((r) => props.valueGetter(r) === elem.value) || null
                : null;
        props.onSelect(resource);
    }

    const selectedValue = props.selectedItem !== null ? props.valueGetter(props.selectedItem) : "";

    return (
        <>
            {isLoading(resources) && <VSCodeProgressRing style={{ height: "1rem" }} />}
            {isLoaded(resources) && (
                <VSCodeDropdown className={props.className} id={props.id} value={selectedValue} onChange={handleChange}>
                    <VSCodeOption value="" selected={selectedValue === ""}>
                        Select
                    </VSCodeOption>
                    {resources.value.map((r) => (
                        <VSCodeOption
                            key={props.valueGetter(r)}
                            value={props.valueGetter(r)}
                            selected={selectedValue === props.valueGetter(r)}
                        >
                            {props.labelGetter(r)}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
            )}
        </>
    );
}
