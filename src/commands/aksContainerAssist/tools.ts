import * as vscode from "vscode";
import * as path from "path";
import { logger } from "./logger";

// --- Tool Definitions ---

export const READ_PROJECT_FILE_TOOL: vscode.LanguageModelChatTool = {
    name: "readProjectFile",
    description:
        "Read a file from the project to verify entry points, build config, source structure, etc. Path is relative to project root.",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Relative file path (e.g., 'src/index.ts', 'tsconfig.json', 'Makefile')",
            },
            maxLines: {
                type: "number",
                description: "Max lines to return (default 150). Use smaller values for large files.",
            },
        },
        required: ["path"],
    },
};

export const LIST_DIRECTORY_TOOL: vscode.LanguageModelChatTool = {
    name: "listDirectory",
    description: "List files and subdirectories in a project directory to understand project structure.",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Relative directory path (e.g., '.', 'src', 'cmd')",
            },
            maxDepth: {
                type: "number",
                description: "Max recursion depth (default 2)",
            },
        },
        required: ["path"],
    },
};

export const PROJECT_TOOLS: vscode.LanguageModelChatTool[] = [READ_PROJECT_FILE_TOOL, LIST_DIRECTORY_TOOL];

// --- Security: Blocked File Patterns ---

const BLOCKED_FILE_PATTERNS = [
    /^\.env($|\.local|\.production|\.staging)/i,
    /\.pem$/i,
    /\.key$/i,
    /\.pfx$/i,
    /\.p12$/i,
    /^credentials/i,
    /^secrets?\./i,
    /^\.secrets/i,
    /^id_rsa/i,
    /^id_ed25519/i,
    /\.secret$/i,
];

export function isBlockedFile(relativePath: string): boolean {
    const filename = path.basename(relativePath);
    return BLOCKED_FILE_PATTERNS.some((p) => p.test(filename));
}

function isPathTraversal(relativePath: string, workspaceRoot?: string): boolean {
    const normalized = path.normalize(relativePath);

    // Check for obvious traversal and absolute paths
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        return true;
    }

    // Windows-specific: reject drive-relative paths (e.g., "C:file.txt") and UNC paths ("\\server\share")
    if (/^[a-zA-Z]:/.test(relativePath) || relativePath.startsWith("\\\\")) {
        return true;
    }

    // If workspace root is provided, resolve and verify the path stays within the workspace
    if (workspaceRoot) {
        const resolved = path.resolve(workspaceRoot, normalized);
        if (!resolved.startsWith(path.resolve(workspaceRoot) + path.sep) && resolved !== path.resolve(workspaceRoot)) {
            return true;
        }
    }

    return false;
}

// --- Excluded directories for listDirectory ---

const EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    "bin",
    "obj",
    "__pycache__",
    "venv",
    ".next",
    ".nuxt",
]);

// --- Tool Handlers ---

const DEFAULT_MAX_LINES = 150;
const HARD_CAP_MAX_LINES = 200;
const DEFAULT_MAX_DEPTH = 2;
const HARD_CAP_MAX_DEPTH = 3;
const MAX_ENTRIES = 200;

export async function handleReadProjectFile(
    input: { path: string; maxLines?: number },
    workspaceRoot: string,
): Promise<string> {
    const relativePath = input.path;

    if (isPathTraversal(relativePath, workspaceRoot)) {
        logger.warn(`Tool readProjectFile: path traversal rejected for "${relativePath}"`);
        return `Refused: path traversal is not allowed ("${relativePath}")`;
    }

    if (isBlockedFile(relativePath)) {
        logger.warn(`Tool readProjectFile: blocked file rejected for "${relativePath}"`);
        return `Refused: reading sensitive files is not allowed ("${relativePath}")`;
    }

    const maxLines = Math.min(input.maxLines ?? DEFAULT_MAX_LINES, HARD_CAP_MAX_LINES);
    const absolutePath = path.join(workspaceRoot, relativePath);
    const fileUri = vscode.Uri.file(absolutePath);

    try {
        const fileData = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(fileData).toString("utf-8");
        const lines = content.split("\n");
        const truncated = lines.length > maxLines;
        const resultLines = lines.slice(0, maxLines);
        let result = `File: ${relativePath}\n${resultLines.join("\n")}`;
        if (truncated) {
            result += `\n\n[Truncated: showing ${maxLines} of ${lines.length} lines]`;
        }
        return result;
    } catch {
        return `File not found: "${relativePath}"`;
    }
}

export async function handleListDirectory(
    input: { path: string; maxDepth?: number },
    workspaceRoot: string,
): Promise<string> {
    const relativePath = input.path;

    if (isPathTraversal(relativePath, workspaceRoot)) {
        logger.warn(`Tool listDirectory: path traversal rejected for "${relativePath}"`);
        return `Refused: path traversal is not allowed ("${relativePath}")`;
    }

    const maxDepth = Math.min(input.maxDepth ?? DEFAULT_MAX_DEPTH, HARD_CAP_MAX_DEPTH);
    const absolutePath = path.join(workspaceRoot, relativePath);
    const dirUri = vscode.Uri.file(absolutePath);

    try {
        const entries: string[] = [];
        await walkDirectory(dirUri, "", maxDepth, 0, entries);

        if (entries.length === 0) {
            return `Directory: ${relativePath}\n(empty directory)`;
        }

        return `Directory: ${relativePath}\n${entries.join("\n")}`;
    } catch {
        return `Directory not found: "${relativePath}"`;
    }
}

async function walkDirectory(
    dirUri: vscode.Uri,
    prefix: string,
    maxDepth: number,
    currentDepth: number,
    entries: string[],
): Promise<void> {
    if (entries.length >= MAX_ENTRIES) {
        return;
    }

    const dirEntries = await vscode.workspace.fs.readDirectory(dirUri);

    // Sort: directories first, then files, alphabetically within each group
    dirEntries.sort((a, b) => {
        if (a[1] !== b[1]) {
            return a[1] === vscode.FileType.Directory ? -1 : 1;
        }
        return a[0].localeCompare(b[0]);
    });

    for (const [name, type] of dirEntries) {
        if (entries.length >= MAX_ENTRIES) {
            entries.push(`${prefix}... (truncated at ${MAX_ENTRIES} entries)`);
            return;
        }

        if (type === vscode.FileType.Directory) {
            if (EXCLUDED_DIRS.has(name)) {
                continue;
            }
            entries.push(`${prefix}${name}/`);
            if (currentDepth < maxDepth) {
                const childUri = vscode.Uri.joinPath(dirUri, name);
                await walkDirectory(childUri, `${prefix}  `, maxDepth, currentDepth + 1, entries);
            }
        } else {
            entries.push(`${prefix}${name}`);
        }
    }
}

// --- Tool Call Dispatcher ---

export async function handleToolCall(call: vscode.LanguageModelToolCallPart, workspaceRoot: string): Promise<string> {
    const input = call.input as Record<string, unknown>;

    switch (call.name) {
        case "readProjectFile": {
            if (typeof input.path !== "string" || input.path.trim() === "") {
                return `Error: "path" is required and must be a non-empty string for readProjectFile.`;
            }
            return handleReadProjectFile(
                { path: input.path, maxLines: input.maxLines as number | undefined },
                workspaceRoot,
            );
        }

        case "listDirectory": {
            if (typeof input.path !== "string" || input.path.trim() === "") {
                return `Error: "path" is required and must be a non-empty string for listDirectory.`;
            }
            return handleListDirectory(
                { path: input.path, maxDepth: input.maxDepth as number | undefined },
                workspaceRoot,
            );
        }

        default:
            logger.warn(`Tool call for unknown tool: "${call.name}"`);
            return `Unknown tool: "${call.name}"`;
    }
}
