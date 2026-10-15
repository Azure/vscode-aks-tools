import * as assert from "assert";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import {
    correctedKubectlPath,
    createAuthPromptMonitor,
    describeKubectlCommand,
    getExecOutput,
    invokeKubectlCommandArgs,
    kubectlEnv,
    MAX_KUBECTL_OUTPUT_BYTES,
    parseKubectlCommandArgs,
} from "../../commands/utils/kubectl";
import { NonZeroExitCodeBehaviour } from "../../commands/utils/shell";
import { KubectlDataProvider } from "../../panels/KubectlPanel";
import { MessageSink } from "../../webview-contract/messaging";
import { ToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/kubectl";

/**
 * A stand-in for the ChildProcess that legacySpawnAsChild returns. Emits the given
 * output and then closes with the given code, mirroring the real event order.
 */
function fakeChildProcess(stdout: string | Buffer[], stderr: string, code: number | null) {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    // After the caller has attached its handlers.
    setImmediate(() => {
        for (const chunk of typeof stdout === "string" ? [Buffer.from(stdout)] : stdout) {
            child.stdout.emit("data", chunk);
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

    it("keeps multi-byte characters split across chunks intact", async () => {
        const bytes = Buffer.from("héllo");
        // Split inside "é", which is two bytes in UTF-8.
        const { kubectl } = fakeKubectl(() => fakeChildProcess([bytes.subarray(0, 2), bytes.subarray(2)], "", 0));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod"]);

        assert.ok(result.succeeded);
        assert.strictEqual(result.result.stdout, "héllo");
    });

    it("releases its listeners when kubectl exits", async () => {
        const child = fakeChildProcess("out", "", 0);
        const { kubectl } = fakeKubectl(() => child);

        await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod"]);

        assert.strictEqual(child.listenerCount("close"), 0);
        assert.strictEqual(child.stdout.listenerCount("data"), 0);
    });

    it("fails rather than fall back to a shell string when legacySpawnAsChild is missing", async () => {
        const api = {
            invokeCommand: async () => {
                throw new Error("the string lane must never be reached");
            },
            kubectl: { observeCommand: async () => {} },
        } as unknown as k8s.KubectlV1;

        const result = await invokeKubectlCommandArgs({ api } as k8s.APIAvailable<k8s.KubectlV1>, "/tmp/kubeconfig", [
            "get",
            "pod",
        ]);

        assert.ok(!result.succeeded);
        assert.ok(result.error.includes("update the Kubernetes extension"), result.error);
    });

    it("stops kubectl and fails when output exceeds the limit", async () => {
        let killed = false;
        const big = Buffer.alloc(MAX_KUBECTL_OUTPUT_BYTES + 1);
        const { kubectl } = fakeKubectl(() =>
            Object.assign(fakeChildProcess([big], "", null), { kill: () => (killed = true) }),
        );

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pods", "-A"]);

        assert.ok(killed, "kubectl should be stopped");
        assert.ok(!result.succeeded);
        assert.ok(result.error.includes("exceeded"), result.error);
    });
});

describe("correctedKubectlPath", () => {
    it("leaves an unquoted path alone", () => {
        assert.strictEqual(correctedKubectlPath("C:\\tools\\kubectl.exe", "win32"), undefined);
        assert.strictEqual(correctedKubectlPath("/usr/local/bin/kubectl"), undefined);
    });

    it("removes the quotes the dependency adds to a path with spaces", () => {
        assert.strictEqual(correctedKubectlPath('"/Users/John Smith/bin/kubectl"'), "/Users/John Smith/bin/kubectl");
        assert.strictEqual(
            correctedKubectlPath('"C:\\Program Files\\kubectl\\kubectl.exe"'),
            "C:\\Program Files\\kubectl\\kubectl.exe",
        );
    });

    it("undoes the duplicate .exe the dependency adds on Windows", () => {
        assert.strictEqual(
            correctedKubectlPath('"C:\\Program Files\\kubectl\\kubectl.exe.exe"', "win32"),
            "C:\\Program Files\\kubectl\\kubectl.exe",
        );
        assert.strictEqual(
            correctedKubectlPath('"C:\\Users\\John Smith\\.vs-kubernetes\\tools\\kubectl\\KUBECTL.EXE.exe"', "win32"),
            "C:\\Users\\John Smith\\.vs-kubernetes\\tools\\kubectl\\KUBECTL.EXE",
        );
    });

    it("keeps .exe.exe on other platforms, where the dependency adds nothing", () => {
        assert.strictEqual(
            correctedKubectlPath('"/opt/my tools/kubectl.exe.exe"', "linux"),
            "/opt/my tools/kubectl.exe.exe",
        );
        assert.strictEqual(correctedKubectlPath("C:\\tools\\KUBECTL.EXE.exe", "linux"), undefined);
    });

    it("recovers every configured Windows path from what the dependency launches", () => {
        // vscode-kubernetes-tools 1.4.1: baseKubectlPath quotes paths with spaces, then
        // binutil.execPath appends ".exe" unless the path ends in lowercase ".exe".
        const launchedBy = (configured: string) => {
            const quoted = configured.includes(" ") ? `"${configured}"` : configured;
            if (quoted.endsWith(".exe")) {
                return quoted;
            }
            return quoted.endsWith('"') ? `${quoted.slice(0, -1)}.exe"` : `${quoted}.exe`;
        };

        for (const configured of [
            "C:\\tools\\kubectl.exe",
            "C:\\tools\\KUBECTL.EXE",
            "C:\\tools\\kubectl.Exe",
            "C:\\Program Files\\kubectl\\kubectl.exe",
            "C:\\Program Files\\kubectl\\KUBECTL.EXE",
            "C:\\tools\\kubectl.exe.exe",
        ]) {
            const launched = launchedBy(configured);
            const corrected = correctedKubectlPath(launched, "win32") ?? launched;
            assert.strictEqual(corrected, configured, `launched ${launched}`);
        }
    });
});

describe("kubectlEnv", () => {
    it("puts the kubectl folder first on PATH", () => {
        const env = kubectlEnv("/opt/my tools/kubectl", { PATH: "/usr/bin" }, "linux");
        assert.strictEqual(env.PATH, "/opt/my tools:/usr/bin");
    });

    it("uses the existing Path key and sets HOME on Windows", () => {
        const env = kubectlEnv(
            "C:\\Program Files\\kubectl\\kubectl.exe",
            { Path: "C:\\Windows", USERPROFILE: "C:\\Users\\John Smith" },
            "win32",
        );
        assert.strictEqual(env.Path, "C:\\Program Files\\kubectl;C:\\Windows");
        assert.strictEqual(env.PATH, undefined);
        assert.strictEqual(env.HOME, "C:\\Users\\John Smith");
    });
});

describe("describeKubectlCommand", () => {
    it("hides --from-literal values, which can be secrets", () => {
        assert.strictEqual(
            describeKubectlCommand(["create", "secret", "generic", "s", "--from-literal=password=ghp_abc=def"]),
            "kubectl create secret generic s --from-literal=password=***",
        );
    });

    it("keeps everything else", () => {
        assert.strictEqual(describeKubectlCommand(["get", "pods", "-n", "default"]), "kubectl get pods -n default");
    });
});

describe("createAuthPromptMonitor", () => {
    afterEach(() => sinon.restore());

    it("shows a generic prompt and puts the device login line in the output panel", () => {
        const warning = sinon.stub(vscode.window, "showWarningMessage");
        const channel = { appendLine: sinon.spy(), show: sinon.spy() };
        sinon.stub(vscode.window, "createOutputChannel").returns(channel as unknown as vscode.LogOutputChannel);
        const line =
            "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABC123.";

        const monitor = createAuthPromptMonitor();
        monitor.onStderr(line.slice(0, 20));
        monitor.onStderr(`${line.slice(20)}\n`);

        assert.ok(channel.appendLine.calledOnceWith(line));
        assert.ok(warning.calledOnce);
        assert.ok(!String(warning.firstCall.args[0]).includes("ABC123"), "stderr text must not be in the notification");
    });
});

describe("KubectlDataProvider", () => {
    async function argsFor(command: string): Promise<string[]> {
        const { kubectl, calls } = fakeKubectl(() => fakeChildProcess("", "", 0));
        const provider = new KubectlDataProvider(kubectl, "/tmp/kubeconfig", "cluster", []);
        const webview = { postRunCommandResponse: () => {} } as unknown as MessageSink<ToWebViewMsgDef>;
        provider.getMessageHandler(webview).runCommandRequest({ command }, "runCommandRequest");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return calls[0];
    }

    it("puts --kubeconfig before a -- separator, so it does not reach the pod", async () => {
        assert.deepStrictEqual(await argsFor("exec mypod -- ls"), [
            "exec",
            "mypod",
            "--kubeconfig",
            "/tmp/kubeconfig",
            "--",
            "ls",
        ]);
    });

    it("keeps --kubeconfig after a plugin name, which kubectl requires", async () => {
        assert.deepStrictEqual(await argsFor("node-shell mynode -- uname -a"), [
            "node-shell",
            "mynode",
            "--kubeconfig",
            "/tmp/kubeconfig",
            "--",
            "uname",
            "-a",
        ]);
    });

    it("drops a leading kubectl but keeps kubectl inside other arguments", async () => {
        assert.deepStrictEqual(await argsFor("kubectl get pods -n kubectl-system"), [
            "get",
            "pods",
            "-n",
            "kubectl-system",
            "--kubeconfig",
            "/tmp/kubeconfig",
        ]);
    });
});

describe("invokeKubectlCommandArgs with a kubectl path containing spaces", () => {
    let dir: string;
    let bin: string;

    before(function () {
        // Shebang scripts can be spawned without a shell only on Unix.
        if (process.platform === "win32") {
            this.skip();
        }

        // Stand-in kubectl under a path with a space; echoes its arguments.
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubectl dir "));
        bin = path.join(dir, "kubectl");
        fs.writeFileSync(bin, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o755 });
    });

    after(() => {
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("runs the unquoted path when the dependency launches a quoted one", async () => {
        // Mirrors the dependency: await, then spawn the quoted path without a shell.
        const { kubectl, calls } = fakeKubectl(() => undefined);
        const internal = (kubectl.api as unknown as { kubectl: Record<string, unknown> }).kubectl;
        internal.legacySpawnAsChild = async (args: string[]) => {
            calls.push(args);
            await Promise.resolve();
            return spawn(`"${bin}"`, args);
        };

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod", "a b; $(x)"]);

        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        assert.deepStrictEqual(result.result.stdout.trimEnd().split("\n"), [
            "get",
            "pod",
            "a b; $(x)",
            "--kubeconfig",
            "/tmp/kubeconfig",
        ]);
        assert.strictEqual(calls.length, 1, "the dependency should still be asked to launch kubectl");
    });
});

describe("invokeKubectlCommandArgs when a corrected path was launched successfully", () => {
    it("uses the original process and does not run kubectl twice", async () => {
        // A path the correction would change, but which really exists, so the launch works.
        const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        Object.assign(child, { spawnfile: '"/opt/my tools/kubectl"' });
        setImmediate(() => {
            child.emit("spawn");
            setImmediate(() => {
                child.stdout.emit("data", Buffer.from("from the original launch"));
                child.emit("close", 0);
            });
        });
        const { kubectl } = fakeKubectl(() => child);

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["delete", "pod", "p"]);

        // A relaunch of the corrected path would fail, since it does not exist, so this output
        // can only come from the original process.
        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        assert.strictEqual(result.result.stdout, "from the original launch");
    });
});

describe("invokeKubectlCommandArgs with an unquoted kubectl path", () => {
    it("reads the dependency's process and starts no other", async () => {
        const { kubectl } = fakeKubectl(() => {
            const child = fakeChildProcess("from the dependency", "", 0);
            return Object.assign(child, { spawnfile: "/usr/local/bin/kubectl" });
        });

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["version"]);

        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        assert.strictEqual(result.result.stdout, "from the dependency");
    });
});

describe("getExecOutput", () => {
    it("passes the pod command as separate arguments, with kubeconfig before the separator", async () => {
        const { kubectl, calls } = fakeKubectl(() => fakeChildProcess("eth0", "", 0));

        const result = await getExecOutput(kubectl, "/tmp/kubeconfig", "default", "debug-node", [
            "/bin/sh",
            "-c",
            "tcpdump --list-interfaces",
        ]);

        assert.ok(result.succeeded, "should succeed");
        assert.deepStrictEqual(calls[0], [
            "exec",
            "-n",
            "default",
            "debug-node",
            "--kubeconfig",
            "/tmp/kubeconfig",
            "--",
            "/bin/sh",
            "-c",
            "tcpdump --list-interfaces",
        ]);
    });
});

describe("parseKubectlCommandArgs", () => {
    function parse(command: string): string[] {
        const result = parseKubectlCommandArgs(command);
        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        return result.result;
    }

    it('reads \\" inside double quotes as a quote, as in the kubectl docs', () => {
        const args = parse(String.raw`get pods -o=jsonpath="{.metadata.name}{\"\t\"}{end}"`);
        assert.deepStrictEqual(args, ["get", "pods", String.raw`-o=jsonpath={.metadata.name}{"\t"}{end}`]);
    });

    it("keeps single-quoted text as is", () => {
        const args = parse(String.raw`get pods -o jsonpath='{.metadata.name}{"\n"}'`);
        assert.deepStrictEqual(args, ["get", "pods", "-o", String.raw`jsonpath={.metadata.name}{"\n"}`]);
    });

    it("keeps other backslashes, such as in jsonpath keys and Windows paths", () => {
        assert.deepStrictEqual(parse(String.raw`get secret s -o jsonpath="{.data.tls\.crt}"`), [
            "get",
            "secret",
            "s",
            "-o",
            String.raw`jsonpath={.data.tls\.crt}`,
        ]);
        assert.deepStrictEqual(parse(String.raw`apply -f C:\Users\me\app.yaml`), [
            "apply",
            "-f",
            String.raw`C:\Users\me\app.yaml`,
        ]);
    });

    it("rejects shell operators", () => {
        assert.ok(!parseKubectlCommandArgs("get pods -o yaml > out.yaml").succeeded);
    });
});
