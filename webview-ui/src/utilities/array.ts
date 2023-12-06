export type Lookup<T> = {
    [key: string]: T;
};

export function asLookup<T>(items: T[], keyFn: (value: T) => ItemKey): Lookup<T> {
    const entries = items.map((val) => [keyFn(val), val]);
    return Object.fromEntries(entries);
}

export function replaceItem<T>(items: T[], predicate: (item: T) => boolean, replacer: (item: T) => T): T[] {
    const index = items.findIndex(predicate);
    if (index === -1) {
        return items;
    }

    const newItem = replacer(items[index]);
    return [...items.slice(0, index), newItem, ...items.slice(index + 1)];
}

export function distinct(items: string[]) {
    return [...new Set(items)];
}

export function intersection<T>(itemsA: T[], itemsB: T[]): T[] {
    return itemsA.filter((a) => itemsB.includes(a));
}

export function exclude<T>(take: T[], exclude: T[]): T[] {
    return take.filter((a) => !exclude.includes(a));
}

export type ItemKey = { [key: string]: string } | string;

export function updateValues<TKey extends ItemKey, TItem>(
    items: TItem[],
    updatedKeys: TKey[],
    keyFn: (item: TItem) => TKey,
    itemFn: (key: TKey) => TItem,
): TItem[] {
    const lookup = asLookup(items, keyFn);
    return updatedKeys.map((key) => {
        const keyId = getKeyId(key);
        return keyId in lookup ? lookup[keyId] : itemFn(key);
    });
}

function getKeyId(key: ItemKey): string {
    if (key instanceof Object) {
        return Object.keys(key)
            .map((keyPart) => key[keyPart])
            .join("\0");
    }

    return key;
}
