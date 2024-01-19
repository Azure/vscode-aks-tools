import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "bdd",
    });

    const testsRoot = path.resolve(__dirname);
    const files = await glob("**/**.test.js", { cwd: testsRoot });

    // Add files to the test suite
    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    try {
        return new Promise<void>((c, e) => {
            // Run the mocha test
            // https://github.com/mochajs/mocha/issues/4625#issuecomment-1000683844
            mocha.loadFilesAsync().then(() => mocha.run((failures) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            })).catch(() => process.exitCode = 1);
        });
    } catch (err) {
        console.error(err);
    }
}
