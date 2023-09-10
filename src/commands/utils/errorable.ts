export interface Succeeded<T> {
    readonly succeeded: true;
    readonly result: T;
}

export interface Failed {
    readonly succeeded: false;
    readonly error: string;
}

export type Errorable<T> = Succeeded<T> | Failed;

export function succeeded<T>(e: Errorable<T>): e is Succeeded<T> {
    return e.succeeded;
}

export function failed<T>(e: Errorable<T>): e is Failed {
    return !e.succeeded;
}

export function success<T>(item: T): Errorable<T> {
    return { succeeded: true, result: item };
}

export function map<T, U>(e: Errorable<T>, fn: (t: T) => U): Errorable<U> {
    if (failed(e)) {
        return { succeeded: false, error: e.error };
    }
    return { succeeded: true, result: fn(e.result) };
}

export function bind<T, U>(e: Errorable<T>, fn: (t: T) => Errorable<U>): Errorable<U> {
    if (failed(e)) {
        return e;
    }
    return fn(e.result);
}

export function bindAsync<T, U>(e: Errorable<T>, fn: (t: T) => Promise<Errorable<U>>): Promise<Errorable<U>> {
    if (failed(e)) {
        return Promise.resolve(e);
    }
    return fn(e.result);
}

export function bindAll<T, U>(es: Errorable<T[]>, fn: (t: T) => Errorable<U>): Errorable<U[]> {
    if (failed(es)) {
        return es;
    }
    return applyAll(es.result, fn);
}

export function bindAllAsync<T, U>(es: Errorable<T[]>, fn: (t: T) => Promise<Errorable<U>>): Promise<Errorable<U[]>> {
    if (failed(es)) {
        return Promise.resolve(es);
    }
    return applyAllAsync(es.result, fn);
}

export function applyAll<T, U>(items: T[], fn: (t: T) => Errorable<U>): Errorable<U[]> {
    return combine(items.map(fn));
}

export async function applyAllAsync<T, U>(items: T[], fn: (t: T) => Promise<Errorable<U>>): Promise<Errorable<U[]>> {
    const promises = items.map(fn);
    const results = await Promise.all(promises);
    return combine(results);
}

export function combine<T>(es: Errorable<T>[]): Errorable<T[]> {
    const failures = es.filter(failed);
    if (failures.length > 0) {
        return {
            succeeded: false,
            error: failures.map(f => f.error).join('\n')
        };
    }

    return {
        succeeded: true,
        result: es.map(e => (e as Succeeded<T>).result)
    };
}

export function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
       return error.message;
    }
    return String(error);
}

export function findOrError<T>(items: T[], predicate: (value: T, index: number) => boolean, errorMessage: string): Errorable<T> {
    const foundItem = items.find(predicate);
    return foundItem ? { succeeded: true, result: foundItem } : { succeeded: false, error: errorMessage };
}