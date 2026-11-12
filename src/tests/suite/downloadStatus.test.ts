import * as assert from "assert";
import * as fs from "fs/promises";
import { createServer } from "http";
import { tmpdir } from "os";
import * as path from "path";
import * as download from "../../commands/utils/download/download";

describe("Binary download HTTP status", () => {
    for (const status of [200, 404]) {
        it(
            status === 200 ? "writes a successful response" : "does not save an HTTP error page as an executable",
            async () => {
                const directory = await fs.mkdtemp(path.join(tmpdir(), "aks-download-status-"));
                const destination = path.join(directory, "kubectl");
                const server = createServer((_request, response) => {
                    response.writeHead(status);
                    response.end("fixture content");
                });
                try {
                    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
                    const address = server.address();
                    assert.ok(address && typeof address !== "string");

                    const result = await download.to(`http://127.0.0.1:${address.port}/kubectl`, destination);

                    if (status === 200) {
                        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
                        assert.strictEqual(await fs.readFile(destination, "utf8"), "fixture content");
                    } else {
                        assert.ok(!result.succeeded);
                        assert.ok(result.error.includes("HTTP 404"), result.error);
                        await assert.rejects(() => fs.access(destination), { code: "ENOENT" });
                    }
                } finally {
                    await new Promise<void>((resolve, reject) =>
                        server.close((error) => (error ? reject(error) : resolve())),
                    );
                    await fs.rm(directory, { recursive: true, force: true });
                }
            },
        );
    }
});
