import * as assert from "assert";
import * as sinon from "sinon";
import * as shell from "../../../commands/utils/shell";
import {
    buildRetinaCaptureArgs,
    RETINA_CAPTURE_HOST_PATH_BASE_DIR,
    RETINA_CAPTURE_HOST_PATH_SUBPATH,
    RETINA_CAPTURE_NODE_HOST_PATH,
    runRetinaCapture,
} from "../../../commands/aksRetinaCapture/retinaCaptureCommand";

describe("Retina capture command", () => {
    describe("path constants", () => {
        it("node host path is the base dir joined with the subpath", () => {
            assert.strictEqual(
                RETINA_CAPTURE_NODE_HOST_PATH,
                `${RETINA_CAPTURE_HOST_PATH_BASE_DIR}/${RETINA_CAPTURE_HOST_PATH_SUBPATH}`,
            );
        });

        it("host-path subpath is relative (retina v1.x rejects absolute host-path)", () => {
            assert.ok(!RETINA_CAPTURE_HOST_PATH_SUBPATH.startsWith("/"), "host-path subpath must be relative");
            assert.ok(!RETINA_CAPTURE_HOST_PATH_SUBPATH.includes(".."), "host-path subpath must not contain '..'");
        });

        it("base dir is absolute", () => {
            assert.ok(RETINA_CAPTURE_HOST_PATH_BASE_DIR.startsWith("/"), "base dir must be an absolute path");
        });
    });

    describe("buildRetinaCaptureArgs (download flow)", () => {
        const args = buildRetinaCaptureArgs({ captureName: "retina-capture-mycluster", nodeNames: "node1,node2" });

        it("uses a relative --host-path with an absolute --host-path-base-dir", () => {
            assert.deepStrictEqual(args.slice(args.indexOf("--host-path"), args.indexOf("--node-selectors")), [
                "--host-path",
                RETINA_CAPTURE_HOST_PATH_SUBPATH,
                "--host-path-base-dir",
                RETINA_CAPTURE_HOST_PATH_BASE_DIR,
            ]);
        });

        it("host-path resolves to the location the node-explorer pod mounts", () => {
            const baseDir = args[args.indexOf("--host-path-base-dir") + 1];
            const subpath = args[args.indexOf("--host-path") + 1];
            assert.strictEqual(`${baseDir}/${subpath}`, RETINA_CAPTURE_NODE_HOST_PATH);
        });

        it("includes the capture name, node names, namespace and waits for completion", () => {
            assert.deepStrictEqual(args.slice(0, 6), [
                "capture",
                "create",
                "--namespace",
                "default",
                "--name",
                "retina-capture-mycluster",
            ]);
            assert.strictEqual(args[args.indexOf("--node-names") + 1], "node1,node2");
            assert.ok(args.includes("--no-wait=false"), "should wait for the capture to finish");
        });

        it("does not request a blob upload", () => {
            assert.ok(!args.includes("--blob-upload"), "download flow should not upload to blob storage");
        });

        it("does not pass --kubeconfig (retina v1.x ignores it; KUBECONFIG env is used instead)", () => {
            assert.ok(!args.includes("--kubeconfig"), "must not pass --kubeconfig");
        });
    });

    describe("buildRetinaCaptureArgs (upload flow)", () => {
        const sasUri = "https://acct.blob.core.windows.net/container?sig=token";
        const args = buildRetinaCaptureArgs({
            captureName: "retina-capture-mycluster",
            nodeNames: "node1",
            blobUploadSasUri: sasUri,
        });

        it("passes the blob SAS URL as a separate argument", () => {
            assert.strictEqual(args[args.indexOf("--blob-upload") + 1], sasUri);
        });

        it("does not use an on-node host-path when uploading to blob storage", () => {
            assert.ok(!args.includes("--host-path"), "upload flow should not write to a node host-path");
        });

        it("still includes core flags", () => {
            assert.strictEqual(args[args.indexOf("--name") + 1], "retina-capture-mycluster");
            assert.strictEqual(args[args.indexOf("--node-names") + 1], "node1");
            assert.ok(args.includes("--no-wait=false"));
        });
    });

    it("keeps shell metacharacters inside their original argument values", () => {
        const captureName = "retina-capture-context; touch /tmp/pwned & calc.exe";
        const nodeNames = "node-1,$(touch /tmp/node-pwned)|%COMSPEC%";
        const sasUri = "https://acct.example/container?sig=a&command=$(touch%20/tmp/url-pwned)";

        const args = buildRetinaCaptureArgs({ captureName, nodeNames, blobUploadSasUri: sasUri });

        assert.strictEqual(args[args.indexOf("--name") + 1], captureName);
        assert.strictEqual(args[args.indexOf("--node-names") + 1], nodeNames);
        assert.strictEqual(args[args.indexOf("--blob-upload") + 1], sasUri);
        assert.ok(!args.some((arg) => arg === "touch" || arg === "/tmp/pwned"));
    });

    it("executes metacharacter-bearing values without invoking a shell", async () => {
        const execFileStub = sinon
            .stub(shell, "execFile")
            .resolves({ succeeded: true, result: { code: 0, stdout: "capture complete", stderr: "" } });
        const options = {
            captureName: "retina-capture-context; touch /tmp/pwned & calc.exe",
            nodeNames: "node-1,$(touch /tmp/node-pwned)|%COMSPEC%",
            blobUploadSasUri: "https://acct.example/container?sig=a&command=$(touch%20/tmp/url-pwned)",
        };
        const shellOptions = { envAdditions: { KUBECONFIG: "/tmp/config; touch /tmp/config-pwned" } };

        try {
            await runRetinaCapture("/tools/kubectl-retina", options, shellOptions);

            assert.ok(execFileStub.calledOnce, "kubectl-retina must be invoked exactly once without a shell");
            assert.strictEqual(execFileStub.firstCall.args[0], "/tools/kubectl-retina");
            assert.deepStrictEqual(execFileStub.firstCall.args[1], buildRetinaCaptureArgs(options));
            assert.strictEqual(execFileStub.firstCall.args[2], shellOptions);
        } finally {
            execFileStub.restore();
        }
    });
});
