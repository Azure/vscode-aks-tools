import { Filters, GadgetArguments, TraceOutputItem } from "../../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { ProcessThreadKey } from "./gadgets/common";
import { cpuProfileMetadata } from "./gadgets/profile";
import { processSnapshotMetadata, socketSnapshotMetadata } from "./gadgets/snapshot";
import { blockIOTopMetadata, ebpfTopMetadata, fileTopMetadata, tcpTopMetadata } from "./gadgets/top";
import { dnsTraceMetadata, execTraceMetadata, tcpTraceMetadata } from "./gadgets/trace";
import { DataItem, GadgetCategory, GadgetMetadata, GadgetProfileResource, GadgetSnapshotResource, GadgetTopResource, GadgetTraceResource, ItemProperty, SortDirection, SortSpecifier, isDerivedProperty, toSortString } from "./gadgets/types";

export type GadgetConfiguration = {
    category: GadgetCategory,
    resource: string,
    displayProperties: ItemProperty<any>[],
    sortSpecifiers: SortSpecifier<any>[],
    filters: Filters,
    maxItemCount?: number,
    timeout?: number,
    excludeThreads?: boolean
};

export function toGadgetArguments(config: GadgetConfiguration): GadgetArguments {
    return {
        gadgetCategory: config.category,
        gadgetResource: config.resource,
        filters: config.filters,
        // TODO: interval
        maxRows: config.maxItemCount,
        timeout: config.timeout,
        sortString: toSortString(config.sortSpecifiers)
    };
}

export type TraceGadget = GadgetConfiguration & {
    traceId: number
    output: TraceOutputItem[] | null
};

export type ConfiguredGadgetResources<T extends string> = Partial<{[key in T]: GadgetMetadata<string>}>;

const profileGadgetResources: ConfiguredGadgetResources<GadgetProfileResource> = {
    "cpu": cpuProfileMetadata
};

const snapshotGadgetResources: ConfiguredGadgetResources<GadgetSnapshotResource> = {
    "process": processSnapshotMetadata,
    "socket": socketSnapshotMetadata
};

const topGadgetResources: ConfiguredGadgetResources<GadgetTopResource> = {
    "tcp": tcpTopMetadata,
    "block-io": blockIOTopMetadata,
    "ebpf": ebpfTopMetadata,
    "file": fileTopMetadata
};

const traceGadgetResources: ConfiguredGadgetResources<GadgetTraceResource> = {
    "dns": dnsTraceMetadata,
    "tcp": tcpTraceMetadata,
    "exec": execTraceMetadata
};

export const configuredGadgetResources: Record<GadgetCategory, ConfiguredGadgetResources<string>> = {
    "profile": profileGadgetResources,
    "snapshot": snapshotGadgetResources,
    "top": topGadgetResources,
    "trace": traceGadgetResources
};

export function getGadgetMetadata(gadgetCategory: GadgetCategory, gadgetResource: string): GadgetMetadata<string> | null {
    return configuredGadgetResources[gadgetCategory][gadgetResource] || null;
}

export function enrich(configuration: GadgetConfiguration, items: TraceOutputItem[]): TraceOutputItem[] {
    return items.map(item => enrichItem(configuration, item));
}

export function enrichSortAndFilter(configuration: GadgetConfiguration, items: TraceOutputItem[]): TraceOutputItem[] {
    items = enrich(configuration, items);
    items = filterItems(configuration, items);
    if (configuration.sortSpecifiers.length) {
        items = sortItems(items, configuration.sortSpecifiers);
    }

    if (configuration.maxItemCount) {
        items = takeFirstItems(items, configuration.maxItemCount);
    }

    return items;
}

function enrichItem(configuration: GadgetConfiguration, item: TraceOutputItem): TraceOutputItem {
    const itemEntries = Object.entries(item);
    const metadata = getGadgetMetadata(configuration.category, configuration.resource);
    const derivedEntries = metadata ? metadata.allProperties.filter(isDerivedProperty).map(p => [p.key, p.valueGetter(item)]) : [];
    return Object.fromEntries([...itemEntries, ...derivedEntries]);
}

type SortFunction = (a: TraceOutputItem, b: TraceOutputItem) => number;

function negateSortFunction(fn: SortFunction): SortFunction {
    return (a, b) => -fn(a, b);
}

function asSortFunction(specifier: SortSpecifier<any>): SortFunction {
    let key = specifier.property.key;
    let descending = specifier.direction === SortDirection.Descending;
    const fn: SortFunction = (a, b) => {
        if (a[key] > b[key]) {
            return 1;
        } else if (a[key] < b[key]) {
            return -1;
        }

        return 0;
    }

    return descending ? negateSortFunction(fn) : fn;
}

function combineSortFunctions(prev: SortFunction, current: SortFunction): SortFunction {
    return (a, b) => {
        const result = prev(a, b);
        return result === 0 ? current(a, b) : result;
    }
}

function getSortFunction(sortSpecifiers: SortSpecifier<any>[]): SortFunction {
    return sortSpecifiers.map(asSortFunction).reduce(combineSortFunctions);
}

function sortItems(items: TraceOutputItem[], sortSpecifiers: SortSpecifier<any>[]): TraceOutputItem[] {
    if (sortSpecifiers.length === 0) {
        return items;
    }

    return [...items].sort(getSortFunction(sortSpecifiers));
}

function takeFirstItems(items: TraceOutputItem[], maxRows: number): TraceOutputItem[] {
    return items.slice(0, maxRows);
}

function filterItems(configuration: GadgetConfiguration, items: TraceOutputItem[]): TraceOutputItem[] {
    if (configuration.excludeThreads) {
        items = items.map(item => item as DataItem<ProcessThreadKey>).filter(item => item.pid === item.tid);
    }

    return items;
}
