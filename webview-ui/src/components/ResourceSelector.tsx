import { Lazy, asLazy, isLoaded, isLoading, isNotLoaded } from "../utilities/lazy";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { CustomDropdown } from "./CustomDropdown";
import { CustomDropdownOption } from "./CustomDropdownOption";

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

    function handleChange(value: string) {
        const resource =
            value && isLoaded(resources) ? resources.value.find((r) => props.valueGetter(r) === value) || null : null;
        props.onSelect(resource);
    }

    const selectedValue = props.selectedItem !== null ? props.valueGetter(props.selectedItem) : "";

    return (
        <>
            {isLoading(resources) && <VSCodeProgressRing style={{ height: "1rem" }} />}
            {isNotLoaded(resources) && (
                <CustomDropdown
                    className={props.className}
                    disabled={true}
                    id={props.id}
                    onChange={() => {}}
                ></CustomDropdown>
            )}
            {isLoaded(resources) && (
                <CustomDropdown className={props.className} id={props.id} value={selectedValue} onChange={handleChange}>
                    <CustomDropdownOption value="" label="Select" />
                    {resources.value.map((r) => (
                        <CustomDropdownOption
                            key={props.valueGetter(r)}
                            value={props.valueGetter(r)}
                            label={props.labelGetter(r)}
                        />
                    ))}
                </CustomDropdown>
            )}
        </>
    );
}
