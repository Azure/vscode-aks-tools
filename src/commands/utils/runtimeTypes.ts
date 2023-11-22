export function isObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null && value.constructor.name === 'Object';
}

export function isArray(value: unknown): value is unknown[] {
    return typeof value === 'object' && value !== null && value.constructor.name === 'Array';
}

export function isError(value: unknown): value is Error {
    return typeof value === 'object' && value !== null && ["message", "name", "stack"].every(p => p in value);
}