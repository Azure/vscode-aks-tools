enum LoadingState {
    NotLoaded,
    Loading,
    Loaded,
}

export type NotLoaded = {
    loadingState: LoadingState.NotLoaded;
};

export type Loading = {
    loadingState: LoadingState.Loading;
};

export type Loaded<T> = {
    loadingState: LoadingState.Loaded;
    value: T;
};

export type Lazy<T> = NotLoaded | Loading | Loaded<T>;

export function isNotLoaded<T>(l: Lazy<T>): l is NotLoaded {
    return l.loadingState === LoadingState.NotLoaded;
}

export function isLoading<T>(l: Lazy<T>): l is Loading {
    return l.loadingState === LoadingState.Loading;
}

export function isLoaded<T>(l: Lazy<T>): l is Loaded<T> {
    return l.loadingState === LoadingState.Loaded;
}

export function newNotLoaded(): NotLoaded {
    return { loadingState: LoadingState.NotLoaded };
}

export function newLoading(): Loading {
    return { loadingState: LoadingState.Loading };
}

export function newLoaded<T>(value: T): Loaded<T> {
    return { loadingState: LoadingState.Loaded, value };
}

export function orDefault<T>(lazy: Lazy<T>, fallback: T): T {
    return isLoaded(lazy) ? lazy.value : fallback;
}

export function map<T1, T2>(l: Lazy<T1>, fn: (f: T1) => T2): Lazy<T2> {
    if (!isLoaded(l)) {
        return l;
    }

    return newLoaded(fn(l.value));
}
