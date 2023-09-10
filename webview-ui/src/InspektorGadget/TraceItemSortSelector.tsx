import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { FormEvent } from "react";
import { ItemProperty, SortSpecifier, fromSortString, toSortString } from "./helpers/gadgets/types";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface TraceItemSortSelectorProps {
    id: string
    className: React.HTMLAttributes<any>['className']
    required?: boolean
    sortSpecifiers: SortSpecifier<any>[]
    allProperties: ItemProperty<any>[]
    onSortSpecifiersChange: (sortSpecifiers: SortSpecifier<any>[]) => void
}

export function TraceItemSortSelector(props: TraceItemSortSelectorProps) {
    function handleSortStringChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        const sortSpecifiers = fromSortString(input.value, props.allProperties);
        props.onSortSpecifiersChange(sortSpecifiers);
    }

    const sortString = toSortString(props.sortSpecifiers);
    const allowedIdentifiers = props.allProperties.map(p => p.identifier).sort();
    const title = `Allowed properties:\n${allowedIdentifiers.join('\n')}`;
    return (
        <VSCodeTextField title={title} id={props.id} className={props.className} required={props.required} value={sortString} onInput={handleSortStringChange}></VSCodeTextField>
    );
}