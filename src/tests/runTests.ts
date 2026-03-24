import * as path from "path";
import * as fs from "node:fs/promises";
import { runTests } from "@vscode/test-electron";

const DEFAULT_VSCODE_TEST_VERSION = "1.108.1";
const MAX_DOWNLOAD_ATTEMPTS = 3;

function isRecoverableDownloadError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return ["Downloaded file checksum", "ECONNRESET", "ETIMEDOUT", "socket hang up"].some((pattern) =>
        message.includes(pattern),
    );
}

async function clearVSCodeTestCache(extensionDevelopmentPath: string): Promise<void> {
    await fs.rm(path.join(extensionDevelopmentPath, ".vscode-test"), { recursive: true, force: true });
}

async function findLocalVSCodeExecutable(): Promise<string | undefined> {
    const candidates: string[] = [];

    if (process.platform === "darwin") {
        candidates.push(
            "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
            "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron",
            path.join(process.env.HOME ?? "", "Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
            path.join(process.env.HOME ?? "", "Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron"),
        );
    }

    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }

        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // Ignore access failures and continue checking other known install paths.
        }
    }

    return undefined;
}

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../..");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH ?? (await findLocalVSCodeExecutable());
        const version = process.env.VSCODE_TEST_VERSION ?? DEFAULT_VSCODE_TEST_VERSION;

        for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
            try {
                if (attempt > 1 && !vscodeExecutablePath) {
                    await clearVSCodeTestCache(extensionDevelopmentPath);
                }

                // Download VS Code (or use provided binary) and run integration tests.
                await runTests({
                    extensionDevelopmentPath,
                    extensionTestsPath,
                    ...(vscodeExecutablePath ? { vscodeExecutablePath } : { version }),
                });
                return;
            } catch (err) {
                if (attempt === MAX_DOWNLOAD_ATTEMPTS || vscodeExecutablePath || !isRecoverableDownloadError(err)) {
                    throw err;
                }
                console.warn(`VS Code test download failed on attempt ${attempt}. Retrying...`);
            }
        }
    } catch (err) {
        console.error(`Failed to run tests:\n${err}`);
        if (err instanceof Error) {
            console.log(`message: ${err.message}\nname: ${err.name}\nstack: ${err.stack}`);
        }
        process.exit(1);
    }
}

main();
