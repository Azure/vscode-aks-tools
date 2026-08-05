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
        // NOTE: The Windows CI failure previously seen here ("CodeWindow: renderer process gone
        // (reason: oom)") was NOT physical-memory exhaustion. The GitHub-hosted windows-latest
        // runner has 16 GB RAM and the whole test host peaks around ~1.4 GB. The renderer crash
        // was a downstream symptom of a leaked test webview whose orphaned frame the workbench
        // kept posting to ("Render frame was disposed before WebFrameMain could be accessed")
        // while the extension-host event loop was starved on the slow 4-core runner. The real fix
        // lives in the tests (dispose the webview panel; assert synchronously), not in V8 heap or
        // Chromium flags -- raising --max-old-space-size only masked the leak by delaying GC.
        //
        // Pin the VS Code test build to 1.130.0. VS Code 1.131.0 renamed the macOS app binary
        // from "Visual Studio Code.app/Contents/MacOS/Electron" to ".../MacOS/Code", which the
        // pinned @vscode/test-electron (^3.0.0) cannot resolve -- it hardcodes the old "Electron"
        // path and fails on macOS with `spawn .../MacOS/Electron ENOENT`. Pinning keeps CI
        // reproducible; unpin once @vscode/test-electron is upgraded to handle the new name.
        await runTests({
            version: "1.130.0",
            extensionDevelopmentPath,
            extensionTestsPath,
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
