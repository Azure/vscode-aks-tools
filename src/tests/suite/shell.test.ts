import * as assert from "assert";
import { execFile } from "../../commands/utils/shell";

describe("execFile", () => {
    it("passes arguments and environment additions without shell interpretation", async () => {
        const args = ["context; touch /tmp/unix-pwned", "node&calc.exe|%COMSPEC%", "$(touch /tmp/subshell-pwned)"];
        const envValue = "config; touch /tmp/config-pwned & calc.exe | %COMSPEC%";
        const result = await execFile(
            process.execPath,
            [
                "-e",
                'process.stdout.write(JSON.stringify({ args: process.argv.slice(1), env: process.env["AKS_TEST_VALUE"] }))',
                ...args,
            ],
            { envAdditions: { AKS_TEST_VALUE: envValue } },
        );

        if (!result.succeeded) {
            assert.fail(result.error);
        }
        assert.deepStrictEqual(JSON.parse(result.result.stdout), { args, env: envValue });
    });
});
