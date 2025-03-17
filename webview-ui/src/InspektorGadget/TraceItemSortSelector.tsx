import { FormEvent } from "react";
import { ItemProperty, SortSpecifier, fromSortString, toSortString } from "./helpers/gadgets/types";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface TraceItemSortSelectorProps {
    id: string;
    className?: string;
    required?: boolean;
    sortSpecifiers: SortSpecifier<string>[];
    allProperties: ItemProperty<string>[];
    onSortSpecifiersChange: (sortSpecifiers: SortSpecifier<string>[]) => void;
}

export function TraceItemSortSelector(props: TraceItemSortSelectorProps) {
    function handleSortStringChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        const sortSpecifiers = fromSortString(input.value, props.allProperties);
        props.onSortSpecifiersChange(sortSpecifiers);
    }

    const sortString = toSortString(props.sortSpecifiers);
    const allowedIdentifiers = props.allProperties.map((p) => p.identifier).sort();
    const title = `Allowed properties:\n${allowedIdentifiers.join("\n")}`;
    return (
        <input
            type="text"
            title={title}
            id={props.id}
            className={props.className}
            required={props.required}
            value={sortString}
            onInput={handleSortStringChange}
        ></input>
    );
}
