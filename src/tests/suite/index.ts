import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "bdd",
        // Integration tests use vscode.workspace.fs (extension-host RPC), which is slow
        // on CI; Mocha's 2000ms default is too tight and causes flaky timeouts.
        timeout: 20_000,
    });

    const testsRoot = path.resolve(__dirname);
    const files = await glob("**/**.test.js", { cwd: testsRoot });

    // Add files to the test suite
    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    try {
        return new Promise<void>((c, e) => {
            // Run the mocha test
            mocha.run((failures) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        });
    } catch (err) {
        console.error(err);
    }
}
