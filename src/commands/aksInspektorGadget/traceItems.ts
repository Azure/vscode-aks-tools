import { TraceOutputItem } from "../../webview-contract/webviewDefinitions/inspektorGadget";
import { Errorable, map as errmap } from "../utils/errorable";
import { parseJson } from "../utils/json";

// The keys of values which should be serialized as JSON, rather than flattened or spread into separate
// objects (see `asFlatItems`).
const jsonKeys = ["userStack", "kernelStack", "addresses", "args"];

/**
 * Takes IG output and converts it to an array of (unflattened) objects.
 * The JSON may be a single object or an array, but this will always return an array.
 * @param line A line from stdout which is assumed to be JSON.
 * @returns An array of objects.
 */
export function parseOutputLine(line: string): Errorable<object[]> {
    line = line.trim();
    if (!line) {
        return { succeeded: true, result: [] };
    }

    const objectOrArray = parseJson<object | object[]>(line);
    return errmap(objectOrArray, objOrArray => isArray(objOrArray) ? objOrArray as object[] : [objOrArray as object]);
}

/**
 * Flattens complex objects into ones that can be read with simple property lookups. This involves two transformations:
 * - Nested objects are flattened, e.g.:
 *   {a: 1, b: {c: 2, d: 3}}   ===>   {a: 1, "b.c": 2, "b.d": 3}
 * - Arrays are spread out into multiple objects, e.g.:
 *   {a: [1,2]}   ===>   [{a: 1}, {b: 2}]
 *   {processes: [{pid: 1, comm: "a"}, {pid: 2, comm: "b"}]}   ===>   [{"processes.pid": 1, "processes.comm": "a"}, {"processes.pid": 2, "processes.comm": "b"}]
 * @param item An item read from the `gadgettracermanager` process.
 * @returns An array of objects that contain no nested objects or arrays for consumption by the webview presentation layer.
 */
export function asFlatItems(item: object): TraceOutputItem[] {
    const allObjectEntries = Object.entries(item).reduce(addFlatEntries, [[]]);
    return allObjectEntries.map(objectEntries => Object.fromEntries(objectEntries));
}

export function isObject(value: any) {
    return value !== null ? value.constructor.name === 'Object' : false;
}

export function isArray(value: any) {
    return value !== null ? value.constructor.name === 'Array' : false;
}

type ObjectEntry = [string, any];
type ObjectEntries = ObjectEntry[];
type MultiObjectEntries = ObjectEntries[];

// Function for folding/reducing an object's properties into a collection of flattened property entries.
function addFlatEntries(allObjectEntries: MultiObjectEntries, entry: ObjectEntry): MultiObjectEntries {
    const [key, value] = entry;

    if (jsonKeys.includes(key)) {
        // Add an entry where the value is a JSON string.
        return allObjectEntries.map(objectEntries => [...objectEntries, [key, JSON.stringify(value)]]);
    }

    if (isArray(value)) {
        // Create new target objects for every item in the array.
        // To each of those we add all the existing properties, as well as the array item properties.
        return (value as any[]).flatMap(val => addFlatEntries(allObjectEntries, [key, val]));
    }

    if (isObject(value)) {
        // Add entries for each of this object's properties, to each of the target objects,
        // making sure to prepend the parent key, e.g.:
        // [key, {subkey: 1}] ==> ["key.subkey": 1]
        const prependKey: (e: ObjectEntry) => ObjectEntry = e => [`${key}.${e[0]}`, e[1]];
        return Object.entries(value).map(prependKey).reduce(addFlatEntries, allObjectEntries);
    }

    // This is a simple property. Append an entry for this to every target object.
    return allObjectEntries.map(objectEntries => [...objectEntries, [key, value]]);
}