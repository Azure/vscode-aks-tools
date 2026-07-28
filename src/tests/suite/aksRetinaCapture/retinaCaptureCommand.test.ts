import * as assert from "assert";
import {
    buildRetinaCaptureCommand,
    RETINA_CAPTURE_HOST_PATH_BASE_DIR,
    RETINA_CAPTURE_HOST_PATH_SUBPATH,
    RETINA_CAPTURE_NODE_HOST_PATH,
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

    describe("buildRetinaCaptureCommand (download flow)", () => {
        const cmd = buildRetinaCaptureCommand({ captureName: "retina-capture-mycluster", nodeNames: "node1,node2" });

        it("uses a relative --host-path with an absolute --host-path-base-dir", () => {
            assert.ok(
                cmd.includes(`--host-path ${RETINA_CAPTURE_HOST_PATH_SUBPATH}`),
                "should pass the relative host-path subpath",
            );
            assert.ok(
                cmd.includes(`--host-path-base-dir ${RETINA_CAPTURE_HOST_PATH_BASE_DIR}`),
                "should pass the host-path-base-dir",
            );
        });

        it("does not pass an absolute path to --host-path", () => {
            assert.ok(!/--host-path\s+\//.test(cmd), `--host-path must not be absolute; got: ${cmd}`);
        });

        it("host-path resolves to the location the node-explorer pod mounts", () => {
            const baseDir = cmd.match(/--host-path-base-dir\s+(\S+)/)?.[1];
            const subpath = cmd.match(/--host-path\s+(\S+)/)?.[1];
            assert.strictEqual(`${baseDir}/${subpath}`, RETINA_CAPTURE_NODE_HOST_PATH);
        });

        it("includes the capture name, node names, namespace and waits for completion", () => {
            assert.ok(cmd.includes("--name retina-capture-mycluster"), "should include capture name");
            assert.ok(cmd.includes('--node-names "node1,node2"'), "should include node names");
            assert.ok(cmd.includes("--namespace default"), "should target the default namespace");
            assert.ok(cmd.includes("--no-wait=false"), "should wait for the capture to finish");
        });

        it("does not request a blob upload", () => {
            assert.ok(!cmd.includes("--blob-upload"), "download flow should not upload to blob storage");
        });

        it("starts with the capture create subcommand (binary is invoked directly)", () => {
            assert.ok(cmd.startsWith("capture create"), "should start with `capture create`");
            assert.ok(!cmd.startsWith("retina "), "should not include the `retina` kubectl-plugin prefix");
        });

        it("does not pass --kubeconfig (retina v1.x ignores it; KUBECONFIG env is used instead)", () => {
            assert.ok(!cmd.includes("--kubeconfig"), "must not pass --kubeconfig");
        });
    });

    describe("buildRetinaCaptureCommand (upload flow)", () => {
        const sasUri = "https://acct.blob.core.windows.net/container?sig=token";
        const cmd = buildRetinaCaptureCommand({
            captureName: "retina-capture-mycluster",
            nodeNames: "node1",
            blobUploadSasUri: sasUri,
        });

        it("passes the blob SAS URL via --blob-upload", () => {
            assert.ok(cmd.includes(`--blob-upload="${sasUri}"`), "should pass the SAS URL");
        });

        it("does not use an on-node host-path when uploading to blob storage", () => {
            assert.ok(!cmd.includes("--host-path"), "upload flow should not write to a node host-path");
        });

        it("still includes core flags", () => {
            assert.ok(cmd.includes("--name retina-capture-mycluster"));
            assert.ok(cmd.includes('--node-names "node1"'));
            assert.ok(cmd.includes("--no-wait=false"));
        });
    });
});
