export type Just<T> = {
    hasValue: true;
    value: T;
};

export type Nothing = {
    hasValue: false;
};

export type Maybe<T> = Just<T> | Nothing;

export function just<T>(value: T): Just<T> {
    return {
        hasValue: true,
        value,
    };
}

export function nothing(): Nothing {
    return { hasValue: false };
}

export function hasValue<T>(m: Maybe<T>): m is Just<T> {
    return m.hasValue;
}

export function isNothing<T>(m: Maybe<T>): m is Nothing {
    return !m.hasValue;
}

export function map<T, U>(m: Maybe<T>, fn: (value: T) => U): Maybe<U> {
    return hasValue(m) ? just(fn(m.value)) : nothing();
}

export function orDefault<T>(m: Maybe<T>, fallback: T): T {
    return hasValue(m) ? m.value : fallback;
}

export function asNullable<T>(m: Maybe<T>): T | null {
    return m.hasValue ? m.value : null;
}
