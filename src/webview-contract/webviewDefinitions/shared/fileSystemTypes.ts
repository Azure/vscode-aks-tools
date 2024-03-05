export type FileSystemType = "file" | "directory";

export type FileFilters = { [name: string]: string[] };

export interface SaveFileOptions {
    defaultPath?: string;
    buttonLabel?: string;
    filters?: FileFilters;
    title?: string;
}

export interface OpenFileOptions {
    defaultPath?: string;
    buttonLabel?: string;
    type: FileSystemType;
    canSelectMany?: boolean;
    filters?: FileFilters;
    title?: string;
}

export type SaveFileResult = {
    path: string;
    exists: boolean;
};

export type OpenFileResult = {
    paths: [string, ...string[]];
};
