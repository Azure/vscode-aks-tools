/**
 * Serializes and encodes the initial state so that it's safe to be placed in an HTML attribute.
 * If no state is defined this will return the empty string.
 */
export function encodeState<T>(initialState?: T): string {
    const initialStateJson = initialState ? JSON.stringify(initialState) : "";
    return initialStateJson
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Decodes and deserializes initial state from a value in an HTML attribute. If no value is supplied
 * this will return an empty object.
 */
export function decodeState<T>(encodedState?: string): T {
    const initialStateJson = (encodedState || "{}")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');

    return JSON.parse(initialStateJson);
}