import { Errorable, getErrorMessage } from "./errorable";

export function parseJson<T>(input: string): Errorable<T> {
    try {
        const result = JSON.parse(input) as T;
        return { succeeded: true, result };
    } catch (e) {
        return { succeeded: false, error: `Error parsing JSON: ${getErrorMessage(e)}\nInput: ${input}` };
    }
}