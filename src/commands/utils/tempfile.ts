import * as vscode from "vscode";
import * as fs from "fs/promises";
import { fileSync } from "tmp";

export async function withOptionalTempFile<T>(
    content: string,
    extension: string,
    fn: (filename: string) => Promise<T>,
): Promise<T> {
    const tempFile = await createTempFile(content, extension);

    try {
        return await fn(tempFile.filePath);
    } finally {
        tempFile.dispose();
    }
}

export async function createTempFile(content: string, extension: string): Promise<TempFile> {
    // TODO: try/catch and return errorable?
    const tempFile = fileSync({ prefix: "aks-periscope-", postfix: `.${extension}` });
    await fs.writeFile(tempFile.name, content);
    return new TempFile(tempFile);
}

export async function createTempFileWithPrefix(content: string, extension: string, prefix: string): Promise<TempFile> {
    // TODO: try/catch and return errorable?
    const tempFile = fileSync({ prefix: prefix || "aks-vscodetemfileprefix-", postfix: `.${extension}` });
    await fs.writeFile(tempFile.name, content);
    return new TempFile(tempFile);
}

export class TempFile extends vscode.Disposable {
    public readonly filePath: string;

    constructor(reference: TempFileReference) {
        super(() => reference.removeCallback());
        this.filePath = reference.name;
    }
}

interface TempFileReference {
    name: string;
    removeCallback(): void;
}
