import {
    FileFilters,
    FileSystemType,
} from "../../../../src/webview-contract/webviewDefinitions/shared/fileSystemTypes";

type FileOrDirectoryItem = {
    type: FileSystemType;
    name: string;
    path: string[];
};

export type Directory = FileOrDirectoryItem & {
    type: "directory";
    contents: FileOrDirectory[];
};

export type File = FileOrDirectoryItem & {
    type: "file";
};

export type FileOrDirectory = File | Directory;

export function isDirectory(fileOrDirectory: FileOrDirectory): fileOrDirectory is Directory {
    return fileOrDirectory.type === "directory";
}

export function fromFindOutput(findOutput: string, rootDirectoryName: string): Directory {
    const { path, name } = asPathAndName(rootDirectoryName);
    const rootDirectory: Directory = {
        type: "directory",
        name,
        path,
        contents: [],
    };

    const lines = findOutput
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && l !== "d .")
        .map(asFileOrDirectory);

    return lines.reduce<Directory>(combineFiles, rootDirectory);
}

export function getRelativePath(rootPath: string, nestedPath: string): string {
    return nestedPath.slice(rootPath.length).replace(/^\//, "");
}

export function asPathString(item: FileOrDirectory): string {
    return `/${item.path.join("/")}/${item.name}`;
}

export function asPathParts(path: string): string[] {
    return path
        .trim()
        .split("/")
        .filter((d) => d !== "" && d !== ".");
}

export function asPathAndName(fullFilePath: string): { path: string[]; name: string } {
    const pathParts = asPathParts(fullFilePath);
    const [name] = pathParts.slice(-1);
    const path = pathParts.slice(0, -1);
    return { path, name: name || "/" };
}

export function iterate(directory: Directory, callback: (item: FileOrDirectory) => void): void {
    for (const item of directory.contents) {
        callback(item);
        if (isDirectory(item)) {
            iterate(item, callback);
        }
    }
}

function asFileOrDirectory(line: string): FileOrDirectory {
    const parts = line.split(" ");
    const typeAbbrev = parts[0].trim();
    const type = typeAbbrev === "d" ? "directory" : "file";
    const { path, name } = asPathAndName(parts[1]);
    return createFileOrDirectory(name, path, type);
}

function createFileOrDirectory(name: string, path: string[], type: FileSystemType): FileOrDirectory {
    switch (type) {
        case "file":
            return { type, name, path };
        case "directory":
            return { type, name, path, contents: [] };
        default:
            throw new Error(`Unexpected file type ${type}`);
    }
}

function combineFiles(rootDir: Directory, item: FileOrDirectory): Directory {
    let parentDir = rootDir;
    const rootDirPath = rootDir.name === "/" ? [...rootDir.path] : [...rootDir.path, rootDir.name];
    let parentPath = rootDirPath;
    for (const dir of item.path) {
        parentPath = [...parentPath, dir];
        let foundDir = parentDir.contents.filter(isDirectory).find((item) => item.name === dir);
        if (!foundDir) {
            foundDir = {
                type: "directory",
                name: dir,
                path: parentPath,
                contents: [],
            };
            parentDir.contents.push(foundDir);
        }
        parentDir = foundDir;
    }

    parentDir.contents.push({ ...item, path: [...rootDirPath, ...item.path] });
    return rootDir;
}

export function addDirectory(rootDir: Directory, directoryPath: string[]): void {
    const parentDir = findFileSystemItem(rootDir, directoryPath.slice(0, -1));
    if (!parentDir) throw new Error(`Could not find parent directory ${directoryPath.slice(0, -1).join("/")}`);
    if (!isDirectory(parentDir)) throw new Error(`Parent directory ${directoryPath.slice(0, -1).join("/")} is a file`);
    const existingItem = findFileSystemItem(parentDir, directoryPath);
    if (existingItem) throw new Error(`Directory ${directoryPath.join("/")} already exists`);

    parentDir.contents.push({
        type: "directory",
        name: directoryPath[directoryPath.length - 1],
        path: directoryPath.slice(0, -1),
        contents: [],
    });
}

export function addFileSystemItem(rootDir: Directory, fullPath: string[], type: FileSystemType): void {
    const path = fullPath.slice(0, -1);
    const parentDir = findFileSystemItem(rootDir, path);
    if (!parentDir) throw new Error(`Could not find parent directory ${path.join("/")}`);
    if (!isDirectory(parentDir)) throw new Error(`Parent directory ${path.join("/")} is a file`);
    const existingItem = findFileSystemItem(parentDir, fullPath);
    if (existingItem) {
        if (type === "file" || !isDirectory(existingItem)) {
            throw new Error(`File ${fullPath.join("/")} already exists`);
        }
        return;
    }
    const name = fullPath[fullPath.length - 1];
    parentDir.contents.push(createFileOrDirectory(name, path, type));
}

export function findFileSystemItem(searchIn: FileOrDirectory, itemPath: string[]): FileOrDirectory | null {
    const searchInPath = [...searchIn.path, searchIn.name];
    const isItemAsDeep = itemPath.length >= searchInPath.length;
    if (!isItemAsDeep) return null;

    const isItemInSearchPath = searchInPath.slice(0, itemPath.length).every((dir, i) => itemPath[i] === dir);
    if (!isItemInSearchPath) return null;

    if (itemPath.length === searchInPath.length) {
        return searchIn;
    }

    // Not an exact file/directory match. The item could be a descendent if this is a directory.
    if (!isDirectory(searchIn)) return null;
    for (const childItem of searchIn.contents) {
        const foundDirectory = findFileSystemItem(childItem, itemPath);
        if (foundDirectory) return foundDirectory;
    }

    return null;
}

export function matchesFilter(item: FileOrDirectory, filter: FileFilters, directoriesOnly: boolean): boolean {
    if (isDirectory(item)) return true;
    if (directoriesOnly) return false;
    const allowedExtensions = Object.values(filter).flatMap((ext) => ext);
    if (allowedExtensions.length === 0) return true;
    const [extension] = item.name.split(".").slice(-1);
    return allowedExtensions.includes(extension);
}
