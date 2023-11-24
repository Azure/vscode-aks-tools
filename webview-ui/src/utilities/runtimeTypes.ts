export function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null && value.constructor.name === "Object";
}

export function isArray(value: unknown): value is unknown[] {
    return typeof value === "object" && value !== null && value.constructor.name === "Array";
}
