import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
    isBlockedFile,
    handleReadProjectFile,
    handleListDirectory,
    handleToolCall,
    PROJECT_TOOLS,
    READ_PROJECT_FILE_TOOL,
    LIST_DIRECTORY_TOOL,
} from "../../../commands/aksContainerAssist/tools";

describe("tools", () => {
    let tempDir: string;

    before(() => {
        // Create a temp directory as our fake workspace root
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tools-test-"));

        // Create test files and directories
        fs.writeFileSync(path.join(tempDir, "index.ts"), "const x = 1;\nconsole.log(x);\n");
        fs.writeFileSync(path.join(tempDir, "package.json"), '{"name": "test", "scripts": {"start": "node index.js"}}');

        // Create a file with many lines for truncation testing
        const manyLines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
        fs.writeFileSync(path.join(tempDir, "big-file.ts"), manyLines);

        // Create src directory with a file
        fs.mkdirSync(path.join(tempDir, "src"));
        fs.writeFileSync(path.join(tempDir, "src", "main.ts"), "export function main() {}");

        // Create nested directories
        fs.mkdirSync(path.join(tempDir, "src", "utils"));
        fs.writeFileSync(path.join(tempDir, "src", "utils", "helper.ts"), "export const helper = true;");

        // Create a node_modules dir (should be excluded from listing)
        fs.mkdirSync(path.join(tempDir, "node_modules"));
        fs.writeFileSync(path.join(tempDir, "node_modules", "foo.js"), "module.exports = {};");

        // Create a .git dir (should be excluded from listing)
        fs.mkdirSync(path.join(tempDir, ".git"));
        fs.writeFileSync(path.join(tempDir, ".git", "config"), "[core]");

        // Create a .env file (should be blocked from reading)
        fs.writeFileSync(path.join(tempDir, ".env"), "SECRET=abc123");
    });

    after(() => {
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe("isBlockedFile", () => {
        it("blocks .env files", () => {
            assert.strictEqual(isBlockedFile(".env"), true);
            assert.strictEqual(isBlockedFile(".env.local"), true);
            assert.strictEqual(isBlockedFile(".env.production"), true);
            assert.strictEqual(isBlockedFile(".env.staging"), true);
        });

        it("blocks key and certificate files", () => {
            assert.strictEqual(isBlockedFile("server.pem"), true);
            assert.strictEqual(isBlockedFile("private.key"), true);
            assert.strictEqual(isBlockedFile("cert.pfx"), true);
            assert.strictEqual(isBlockedFile("cert.p12"), true);
        });

        it("blocks credential files", () => {
            assert.strictEqual(isBlockedFile("credentials.json"), true);
            assert.strictEqual(isBlockedFile("secret.yaml"), true);
            assert.strictEqual(isBlockedFile("secrets.json"), true);
            assert.strictEqual(isBlockedFile(".secrets"), true);
        });

        it("blocks SSH key files", () => {
            assert.strictEqual(isBlockedFile("id_rsa"), true);
            assert.strictEqual(isBlockedFile("id_ed25519"), true);
        });

        it("allows normal project files", () => {
            assert.strictEqual(isBlockedFile("package.json"), false);
            assert.strictEqual(isBlockedFile("tsconfig.json"), false);
            assert.strictEqual(isBlockedFile("src/index.ts"), false);
            assert.strictEqual(isBlockedFile("Dockerfile"), false);
            assert.strictEqual(isBlockedFile("README.md"), false);
        });
    });

    describe("PROJECT_TOOLS", () => {
        it("contains expected tools", () => {
            assert.strictEqual(PROJECT_TOOLS.length, 2);
            assert.strictEqual(PROJECT_TOOLS[0], READ_PROJECT_FILE_TOOL);
            assert.strictEqual(PROJECT_TOOLS[1], LIST_DIRECTORY_TOOL);
        });

        it("readProjectFile has correct schema", () => {
            assert.strictEqual(READ_PROJECT_FILE_TOOL.name, "readProjectFile");
            assert.ok(READ_PROJECT_FILE_TOOL.description);
            assert.ok(READ_PROJECT_FILE_TOOL.inputSchema);
        });

        it("listDirectory has correct schema", () => {
            assert.strictEqual(LIST_DIRECTORY_TOOL.name, "listDirectory");
            assert.ok(LIST_DIRECTORY_TOOL.description);
            assert.ok(LIST_DIRECTORY_TOOL.inputSchema);
        });
    });

    describe("handleReadProjectFile", () => {
        it("rejects path traversal", async () => {
            const result = await handleReadProjectFile({ path: "../../../etc/passwd" }, tempDir);
            assert.ok(result.includes("Refused"));
            assert.ok(result.includes("path traversal"));
        });

        it("rejects absolute paths", async () => {
            const result = await handleReadProjectFile({ path: "/etc/passwd" }, tempDir);
            assert.ok(result.includes("Refused"));
            assert.ok(result.includes("path traversal"));
        });

        it("rejects blocked files", async () => {
            const result = await handleReadProjectFile({ path: ".env" }, tempDir);
            assert.ok(result.includes("Refused"));
            assert.ok(result.includes("sensitive files"));
        });

        it("rejects blocked files in subdirectories", async () => {
            const result = await handleReadProjectFile({ path: "config/.env.local" }, tempDir);
            assert.ok(result.includes("Refused"));
            assert.ok(result.includes("sensitive files"));
        });

        it("returns file not found for missing files", async () => {
            const result = await handleReadProjectFile({ path: "nonexistent.ts" }, tempDir);
            assert.ok(result.includes("File not found"));
        });

        it("reads file successfully", async () => {
            const result = await handleReadProjectFile({ path: "index.ts" }, tempDir);
            assert.ok(result.includes("File: index.ts"));
            assert.ok(result.includes("const x = 1;"));
            assert.ok(result.includes("console.log(x);"));
        });

        it("reads nested file successfully", async () => {
            const result = await handleReadProjectFile({ path: "src/main.ts" }, tempDir);
            assert.ok(result.includes("File: src/main.ts"));
            assert.ok(result.includes("export function main()"));
        });

        it("truncates to maxLines", async () => {
            const result = await handleReadProjectFile({ path: "big-file.ts", maxLines: 10 }, tempDir);
            assert.ok(result.includes("Truncated"));
            assert.ok(result.includes("showing 10 of 300"));
        });

        it("caps maxLines at 200", async () => {
            const result = await handleReadProjectFile({ path: "big-file.ts", maxLines: 500 }, tempDir);
            assert.ok(result.includes("showing 200 of 300"));
        });
    });

    describe("handleListDirectory", () => {
        it("rejects path traversal", async () => {
            const result = await handleListDirectory({ path: "../../" }, tempDir);
            assert.ok(result.includes("Refused"));
            assert.ok(result.includes("path traversal"));
        });

        it("returns directory not found for missing dirs", async () => {
            const result = await handleListDirectory({ path: "nonexistent" }, tempDir);
            assert.ok(result.includes("Directory not found"));
        });

        it("lists directory entries", async () => {
            const result = await handleListDirectory({ path: ".", maxDepth: 0 }, tempDir);
            assert.ok(result.includes("Directory: ."));
            assert.ok(result.includes("src/"));
            assert.ok(result.includes("package.json"));
            assert.ok(result.includes("index.ts"));
        });

        it("skips excluded directories", async () => {
            const result = await handleListDirectory({ path: ".", maxDepth: 0 }, tempDir);
            assert.ok(!result.includes("node_modules"));
            assert.ok(!result.includes(".git/"));
            assert.ok(result.includes("src/"));
        });

        it("recurses into subdirectories", async () => {
            const result = await handleListDirectory({ path: ".", maxDepth: 2 }, tempDir);
            assert.ok(result.includes("src/"));
            assert.ok(result.includes("main.ts"));
            assert.ok(result.includes("utils/"));
            assert.ok(result.includes("helper.ts"));
        });
    });

    describe("handleToolCall", () => {
        it("routes readProjectFile correctly", async () => {
            const call = {
                callId: "test-1",
                name: "readProjectFile",
                input: { path: "index.ts" },
            } as unknown as vscode.LanguageModelToolCallPart;

            const result = await handleToolCall(call, tempDir);
            assert.ok(result.includes("File: index.ts"));
            assert.ok(result.includes("const x = 1;"));
        });

        it("routes listDirectory correctly", async () => {
            const call = {
                callId: "test-2",
                name: "listDirectory",
                input: { path: "src" },
            } as unknown as vscode.LanguageModelToolCallPart;

            const result = await handleToolCall(call, tempDir);
            assert.ok(result.includes("Directory: src"));
        });

        it("returns unknown tool message for unrecognized tools", async () => {
            const call = {
                callId: "test-3",
                name: "unknownTool",
                input: {},
            } as unknown as vscode.LanguageModelToolCallPart;

            const result = await handleToolCall(call, tempDir);
            assert.ok(result.includes("Unknown tool"));
            assert.ok(result.includes("unknownTool"));
        });
    });
});
