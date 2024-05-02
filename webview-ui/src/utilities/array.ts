export type Lookup<T> = {
    [key: string]: T;
};

export function asLookup<T>(items: T[], keyFn: (value: T) => ItemKey): Lookup<T> {
    const entries = items.map((val) => [getKeyId(keyFn(val)), val]);
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

export function getOrThrow<T>(items: T[], predicate: (item: T) => boolean, messageIfMissing: string): T {
    const item = items.find(predicate);
    if (!item) {
        throw new Error(messageIfMissing);
    }

    return item;
}

export type ItemKey = { [key: string]: string } | string;

/**
 * Creates a new array based on an updated set of 'keys', where each key uniquely identifies
 * an item in the array.
 * @param items The existing collection of array items
 * @param updatedKeys The keys of the updated collection
 * @param isMatch A function that determines if a key matches an item
 * @param makeItem A function that creates a new item from a key
 * @returns An updated collection of items with the new keys/
 */
export function updateValues<TKey, TItem>(
    items: TItem[],
    updatedKeys: TKey[],
    isMatch: (key: TKey, item: TItem) => boolean,
    makeItem: (key: TKey) => TItem,
): TItem[] {
    return updatedKeys.map((key) => {
        const matchingItem = items.find((item) => isMatch(key, item));
        return matchingItem !== undefined ? matchingItem : makeItem(key);
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

export function filterNulls<T>(items: (T | null)[]): T[] {
    return items.filter((item) => item !== null) as T[];
}
