import * as assert from "assert";
import { EventEmitter } from "events";
import * as k8s from "vscode-kubernetes-tools-api";
import { invokeKubectlCommandArgs } from "../../commands/utils/kubectl";
import { NonZeroExitCodeBehaviour } from "../../commands/utils/shell";

/**
 * A stand-in for the ChildProcess that legacySpawnAsChild returns. Emits the given
 * output and then closes with the given code, mirroring the real event order.
 */
function fakeChildProcess(stdout: string, stderr: string, code: number | null) {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    // After the caller has attached its handlers.
    setImmediate(() => {
        if (stdout) {
            child.stdout.emit("data", Buffer.from(stdout));
        }
        if (stderr) {
            child.stderr.emit("data", Buffer.from(stderr));
        }
        child.emit("close", code);
    });

    return child;
}

/** A kubectl API exposing the spawn-based lane, capturing the argv it is handed. */
function fakeKubectl(makeChild: () => unknown) {
    const calls: string[][] = [];
    const api = {
        invokeCommand: async () => {
            throw new Error("the string lane must not be used when the spawn lane is available");
        },
        kubectl: {
            observeCommand: async () => {
                throw new Error("not used");
            },
            legacySpawnAsChild: async (args: string[]) => {
                calls.push(args);
                return makeChild();
            },
        },
    };

    return { kubectl: { api } as unknown as k8s.APIAvailable<k8s.KubectlV1>, calls };
}

describe("invokeKubectlCommandArgs", () => {
    it("passes each value as its own argument, with kubeconfig last", async () => {
        const { kubectl, calls } = fakeKubectl(() => fakeChildProcess("nginx", "", 0));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", [
            "get",
            "pod",
            "-n",
            "default",
            "my-pod",
        ]);

        assert.ok(result.succeeded, "should succeed");
        assert.deepStrictEqual(calls[0], ["get", "pod", "-n", "default", "my-pod", "--kubeconfig", "/tmp/kubeconfig"]);
    });

    it("keeps shell metacharacters inside a single argument", async () => {
        const { kubectl, calls } = fakeKubectl(() => fakeChildProcess("", "", 0));
        const hostile = "aks-node$(touch /tmp/pwned); rm -rf ~ & calc.exe";

        await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["delete", "pod", hostile]);

        assert.strictEqual(calls[0][2], hostile, "the payload must stay one argv element");
        assert.ok(
            !calls[0].some((arg) => arg === "rm" || arg === "calc.exe"),
            "nothing may be split out into a separate argument",
        );
    });

    it("carries a path containing spaces as one argument, which the string lane could not", async () => {
        const { kubectl, calls } = fakeKubectl(() => fakeChildProcess("", "", 0));
        const localPath = "C:\\Users\\John Smith\\retina captures\\out";

        await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["cp", "node-explorer-a:mnt/capture", localPath]);

        assert.strictEqual(calls[0][2], localPath, "the path must not be split on its spaces");
    });

    it("returns stdout, stderr and the exit code", async () => {
        const { kubectl } = fakeKubectl(() => fakeChildProcess("out", "err", 0));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["version"]);

        assert.ok(result.succeeded);
        assert.deepStrictEqual(result.result, { code: 0, stdout: "out", stderr: "err" });
    });

    it("fails on a non-zero exit by default", async () => {
        const { kubectl } = fakeKubectl(() => fakeChildProcess("", "NotFound", 1));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod", "missing"]);

        assert.ok(!result.succeeded);
        assert.ok(result.error.includes("status code 1"), result.error);
        assert.ok(result.error.includes("NotFound"), "stderr should be surfaced");
    });

    it("preserves NonZeroExitCodeBehaviour.Succeed, which existence checks rely on", async () => {
        const { kubectl } = fakeKubectl(() => fakeChildProcess("", "NotFound", 1));

        const result = await invokeKubectlCommandArgs(
            kubectl,
            "/tmp/kubeconfig",
            ["get", "workspace", "absent"],
            NonZeroExitCodeBehaviour.Succeed,
        );

        assert.ok(result.succeeded, "a non-zero exit must be a normal result under Succeed");
        assert.strictEqual(result.result.code, 1);
    });

    it("treats a signal kill as a failure rather than success", async () => {
        const { kubectl } = fakeKubectl(() => fakeChildProcess("", "", null));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod"]);

        assert.ok(!result.succeeded, "a null exit code must not be read as 0");
    });

    it("reports a spawn failure instead of throwing", async () => {
        const { kubectl } = fakeKubectl(() => undefined);

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod"]);

        assert.ok(!result.succeeded);
        assert.ok(result.error.includes("could not be started"), result.error);
    });

    it("falls back to the array-based observe lane, never to a shell string", async () => {
        let observedArgs: string[] | undefined;
        const api = {
            invokeCommand: async () => {
                throw new Error("the string lane no longer exists and must never be reached");
            },
            kubectl: {
                observeCommand: async (args: string[]) => {
                    observedArgs = args;
                    return {
                        lines: { subscribe: (o: { complete: () => void }) => o.complete() },
                        terminate: () => {},
                    };
                },
            },
        } as unknown as k8s.KubectlV1;

        const hostile = "node$(touch /tmp/pwned)";
        const result = await invokeKubectlCommandArgs({ api } as k8s.APIAvailable<k8s.KubectlV1>, "/tmp/kubeconfig", [
            "delete",
            "pod",
            hostile,
        ]);

        assert.ok(result.succeeded, "should still work without legacySpawnAsChild");
        assert.strictEqual(observedArgs?.[2], hostile, "the payload must stay one argument in the fallback too");
    });
});
