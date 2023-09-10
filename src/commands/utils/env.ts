import path = require("path");

export function ensureDirectoryInPath(directoryPath: string) {
    if (process.env.PATH === undefined) {
        process.env.PATH = directoryPath
    } else if (process.env.PATH.indexOf(directoryPath) < 0) {
        process.env.PATH = directoryPath + path.delimiter + process.env.PATH;
    }
}