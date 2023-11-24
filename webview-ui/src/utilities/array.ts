export type Lookup<T> = {
    [key: string]: T;
};

export function asLookup<T>(items: T[], keyFn: (value: T) => string): Lookup<T> {
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
