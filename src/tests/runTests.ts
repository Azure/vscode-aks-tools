import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../..");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        // Download VS Code, unzip it and run the integration test.
        //
        // The Windows CI runner is 20-40x slower on the webview/fs-heavy suite than Linux/macOS,
        // so the extension host lingers in a high-memory state long enough to exhaust the default
        // V8 heap and OOM-crash the renderer (reason: oom), failing the run. Raising the old-space
        // ceiling for the extension-host process gives it the headroom to survive that stall.
        // Applied on all platforms (harmless elsewhere; Windows is where it matters).
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            extensionTestsEnv: {
                NODE_OPTIONS: "--max-old-space-size=8192",
            },
        });
    } catch (err) {
        console.error(`Failed to run tests:\n${err}`);
        if (err instanceof Error) {
            console.log(`message: ${err.message}\nname: ${err.name}\nstack: ${err.stack}`);
        }
        process.exit(1);
    }
}

main();
