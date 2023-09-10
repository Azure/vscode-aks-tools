export const gadgetCategories = ["snapshot", "top", "trace", "profile"] as const;
export type GadgetCategory = typeof gadgetCategories[number];

export const gadgetProfileResources = ["block-io", "cpu", "tcprtt"] as const;
export const gadgetSnapshotResources = ["process", "socket"] as const;
export const gadgetTopResources = ["block-io", "ebpf", "file", "tcp"] as const;
export const gadgetTraceResources = ["bind", "capabilities", "dns", "exec", "fsslower", "mount", "network", "oomkill", "open", "signal", "sni", "tcp", "tcpconnect", "tcpdrop", "tcpretrans"] as const;

export type GadgetProfileResource = typeof gadgetProfileResources[number];
export type GadgetSnapshotResource = typeof gadgetSnapshotResources[number];
export type GadgetTopResource = typeof gadgetTopResources[number];
export type GadgetTraceResource = typeof gadgetTraceResources[number];

export enum GadgetExtraProperties {
    None = 0,
    NoK8sResourceFiltering = 1 << 0,
    ThreadExclusionAllowed = 1 << 1,
    SortingAllowed = 1 << 2,
    RequiresTimeout = 1 << 3,
    RequiresMaxItemCount = 1 << 4
}

type ExtraPropertyKeys = Exclude<keyof typeof GadgetExtraProperties, "None">;
export type GadgetExtraPropertyObject = {[key in ExtraPropertyKeys as Uncapitalize<key>]: boolean};

export type GadgetMetadata<TKey extends string> = {
    name: string,
    allProperties: ItemProperty<TKey>[],
    defaultProperties: ItemProperty<TKey>[],
    defaultSort: SortSpecifier<TKey>[] | null
    extraProperties: GadgetExtraProperties
};

function isExtraPropertySet(allProperties: GadgetExtraProperties, property: GadgetExtraProperties): boolean {
    return (allProperties & property) === property;
}

export function toExtraPropertyObject(properties: GadgetExtraProperties): GadgetExtraPropertyObject {
    return {
        noK8sResourceFiltering: isExtraPropertySet(properties, GadgetExtraProperties.NoK8sResourceFiltering),
        requiresMaxItemCount: isExtraPropertySet(properties, GadgetExtraProperties.RequiresMaxItemCount),
        requiresTimeout: isExtraPropertySet(properties, GadgetExtraProperties.RequiresTimeout),
        sortingAllowed: isExtraPropertySet(properties, GadgetExtraProperties.SortingAllowed),
        threadExclusionAllowed: isExtraPropertySet(properties, GadgetExtraProperties.ThreadExclusionAllowed)
    };
}

export type ItemKeyMetadata = {
    identifier: string,
    name: string
    valueType?: ValueType
};

export type ItemMetadata<TKey extends string> = { [key in TKey]: ItemKeyMetadata };

export type DataItem<TKey extends string> = { [key in TKey]: any };

export enum ValueType {
    Bytes,
    CharByte,
    StackTrace,
    AddressArray,
    Timestamp
}

export interface ItemProperty<TKey extends string> {
    name: string
    identifier: string
    key: TKey
    valueType?: ValueType
}

export enum SortDirection {
    Ascending,
    Descending
}

export type SortSpecifier<TKey extends string> = {
    property: ItemProperty<TKey>,
    direction: SortDirection
};

export function toSortString(sortSpecifiers: SortSpecifier<any>[]): string {
    return sortSpecifiers.map(s => `${s.direction === SortDirection.Descending ? '-' : ''}${s.property.identifier}`).join(',');
}

export function fromSortString(sortString: string, allProperties: ItemProperty<any>[]): SortSpecifier<any>[] {
    function asSortSpecifier(sortStringItem: string): SortSpecifier<any> | null {
        let key = sortStringItem.trim();
        let direction = SortDirection.Ascending;
        if (key.startsWith('-')) {
            direction = SortDirection.Descending;
            key = key.slice(1).trim();
        }
    
        const property = findProperty(allProperties, key);
        if (!property) {
            return null;
        }
    
        return { property, direction };
    }

    return sortString.split(',').map(asSortSpecifier).filter(s => s !== null) as SortSpecifier<any>[];
}

export interface DerivedItemProperty<TKey extends string, TDerivedKey extends string> extends ItemProperty<TKey | TDerivedKey> {
    valueGetter: (item: DataItem<TKey>) => any
}

export function isDerivedProperty<TKey extends string, TDerivedKey extends string>(gadgetProperty: ItemProperty<TKey | TDerivedKey>): gadgetProperty is DerivedItemProperty<TKey, TDerivedKey> {
    return (gadgetProperty as DerivedItemProperty<TKey, TDerivedKey>).valueGetter !== undefined;
}

export function getLiteralProperties<TKey extends string>(metadata: ItemMetadata<TKey>): ItemProperty<TKey>[] {
    return Object.keys(metadata).map(key => key as TKey).map(key => ({
        name: metadata[key].name,
        identifier: metadata[key].identifier,
        key,
        valueType: metadata[key].valueType
    }));
}

export function getDerivedProperty<TKey extends string, TDerivedKey extends string>(name: string, key: TDerivedKey, valueGetter: (item: DataItem<TKey>) => any, valueType?: ValueType): DerivedItemProperty<TKey, TDerivedKey> {
    return {name, identifier: key, key, valueGetter, valueType};
}

export function findProperty<TKey extends string>(properties: ItemProperty<TKey>[], key: TKey): ItemProperty<TKey> | null {
    const result = properties.find(p => p.key === key);
    if (!result) {
        return null;
    }
    return result;
}

export function toProperties<TKey extends string>(allProperties: ItemProperty<TKey>[], keys: TKey[]): ItemProperty<TKey>[] {
    return keys.map(key => findProperty(allProperties, key)).filter(p => p !== null) as ItemProperty<TKey>[];
}

export function getSortSpecifiers<TKey extends string>(properties: ItemProperty<TKey>[], specifiers: {key: TKey, direction: SortDirection}[]): SortSpecifier<TKey>[] {
    return specifiers.map(s => ({
        property: findProperty(properties, s.key),
        direction: s.direction
    })).filter(s => s.property !== null) as SortSpecifier<TKey>[];
}
