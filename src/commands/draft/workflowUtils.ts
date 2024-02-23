import { DocumentSymbol, TextDocument, Uri, WorkspaceFolder, commands, languages, workspace } from "vscode";
import { getResourceFileContent } from "../../assets";
import { Errorable, failed, getErrorMessage } from "../utils/errorable";
import { posix, sep } from "path";

export async function createWorkflowFile(
    workspaceFolder: WorkspaceFolder,
    workflowName: string,
    deploymentType: "manifests" | "helm",
): Promise<Errorable<Uri>> {
    const fileContent = getResourceFileContent(`resources/draft/workflow-${deploymentType}.yml`);
    if (failed(fileContent)) {
        return fileContent;
    }

    const workflowDirectoryPath = posix.join(workspaceFolder.uri.path, ".github", "workflows");
    const workflowFilePath = posix.join(workflowDirectoryPath, `${workflowName}.yml`);

    const directoryUri = Uri.file(workflowDirectoryPath);
    const fileUri = Uri.file(workflowFilePath);

    try {
        await workspace.fs.createDirectory(directoryUri); // Equivalent to `mkdirp`.
        await workspace.fs.writeFile(fileUri, fileContent.result);
    } catch (e) {
        return { succeeded: false, error: `Failed to write ${fileUri.fsPath}: ${getErrorMessage(e)}` };
    }

    return { succeeded: true, result: fileUri };
}

export async function getYamlDocumentAndSymbols(
    fileUri: Uri,
): Promise<Errorable<{ document: TextDocument; symbols: DocumentSymbol[] }>> {
    const document = await workspace.openTextDocument(fileUri);
    try {
        await languages.setTextDocumentLanguage(document, "yaml");
    } catch (e) {
        return { succeeded: false, error: `Failed to set language mode for ${fileUri.fsPath}: ${getErrorMessage(e)}` };
    }

    const symbols = (await commands.executeCommand(
        "vscode.executeDocumentSymbolProvider",
        fileUri,
    )) as DocumentSymbol[];

    if (!symbols) {
        return { succeeded: false, error: `Failed to get symbols for ${fileUri.fsPath}` };
    }

    return { succeeded: true, result: { document, symbols } };
}

export async function setWorkflowLanguage(document: TextDocument): Promise<void> {
    const langs = await languages.getLanguages();
    if (langs.includes("github-actions-workflow")) {
        await languages.setTextDocumentLanguage(document, "github-actions-workflow");
    }
}

export function asPosixRelativePath(path: string): string {
    return [".", ...path.split(sep).filter((p) => p.length > 0)].join(posix.sep);
}

export function getMultilineStringValue(indentationDepth: number, lines: string[]): string {
    const indentation = " ".repeat(indentationDepth);
    const valueLines = lines.map((l) => `${indentation}${l}`);
    return `|\n${valueLines.join("\n")}`;
}
