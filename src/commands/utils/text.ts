import { Errorable } from "./errorable";

export function asJson(text: string): Errorable<any> {
    try {
        return { succeeded: true, result: JSON.parse(text) };
    } catch (e) {
        return { succeeded: false, error: `Error parsing text: ${e}` };
    }
}
