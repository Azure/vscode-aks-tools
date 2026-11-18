import * as assert from "assert";
import childProcess from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import {
    createAuthPromptMonitor,
    describeKubectlCommand,
    getExecOutput,
    invokeKubectlCommandArgs,
    kubectlEnv,
    MAX_KUBECTL_OUTPUT_BYTES,
    parseKubectlCommandArgs,
} from "../../commands/utils/kubectl";
import { kubectlExecutablePath } from "../../commands/utils/kubectlExecutable";
import { NonZeroExitCodeBehaviour } from "../../commands/utils/shell";
import { KubectlDataProvider } from "../../panels/KubectlPanel";
import { MessageSink } from "../../webview-contract/messaging";
import { ToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/kubectl";

function fakeChildProcess(
    stdout: string | Buffer[],
    stderr: string,
    code: number | null,
    signal: NodeJS.Signals | null = null,
) {
    const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        kill: sinon.stub().returns(true),
    });

    // After the caller has attached its handlers.
    setImmediate(() => {
        for (const chunk of typeof stdout === "string" ? [Buffer.from(stdout)] : stdout) {
            child.stdout.emit("data", chunk);
        }
        if (stderr) {
            child.stderr.emit("data", Buffer.from(stderr));
        }
        child.emit("close", code, signal);
    });

    return child;
}

function configureKubectl(file: string) {
    const config = {
        get: (_key: string, fallback: unknown) => fallback,
        inspect: (key: string) => (key === "vscode-kubernetes.kubectl-path" ? { globalValue: file } : undefined),
    } as unknown as vscode.WorkspaceConfiguration;
    sinon.stub(vscode.workspace, "getConfiguration").returns(config);
}

function fakeKubectl(makeChild: () => unknown) {
    const calls: string[][] = [];
    configureKubectl(process.execPath);
    const spawn = sinon.stub(childProcess, "spawn").callsFake((_file, args) => {
        calls.push(args as string[]);
        const child = makeChild();
        if (!child) {
            throw new Error("kubectl could not be started");
        }
        return child as childProcess.ChildProcess;
    });
    const api = {
        invokeCommand: sinon.stub().rejects(new Error("the string lane must never be reached")),
    };

    return { kubectl: { available: true, api } as unknown as k8s.APIAvailable<k8s.KubectlV1>, calls, spawn, api };
}

describe("invokeKubectlCommandArgs", () => {
    afterEach(() => sinon.restore());
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

    it("treats signal termination as a failure even when nonzero exits are allowed", async () => {
        const { kubectl } = fakeKubectl(() => fakeChildProcess("", "", null, "SIGTERM"));

        for (const behavior of [undefined, NonZeroExitCodeBehaviour.Succeed]) {
            const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod"], behavior);

            assert.ok(!result.succeeded, "signal termination must not become an ordinary nonzero exit");
            assert.ok(result.error.includes("SIGTERM"), result.error);
        }
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

    it("keeps explicitly masked values out of nonzero errors even when stderr echoes them", async () => {
        const prompt = "private prompt and credentials";
        const { kubectl, calls } = fakeKubectl(() => fakeChildProcess("", `invalid request: ${prompt}`, 7));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["run", "pod", prompt], undefined, {
            sensitiveArgs: [2],
        });

        assert.ok(!result.succeeded);
        assert.ok(!result.error.includes(prompt));
        assert.ok(result.error.includes("status code 7"));
        assert.strictEqual(calls[0][2], prompt);
    });

    it("keeps masked values out of spawn errors", async () => {
        const prompt = "private prompt";
        const { kubectl, spawn } = fakeKubectl(() => undefined);
        spawn.throws(new Error(`spawn failed for ${prompt}`));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["run", "pod", prompt], undefined, {
            sensitiveArgs: [2],
        });

        assert.ok(!result.succeeded);
        assert.ok(!result.error.includes(prompt));
    });

    it("passes sensitive stdin without putting it in argv or failure messages", async () => {
        const secret = JSON.stringify({ password: "private-token" });
        const child = fakeChildProcess("", `invalid Secret: ${secret}`, 1);
        const { kubectl, calls } = fakeKubectl(() => child);

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["create", "-f", "-"], undefined, {
            stdin: secret,
            sensitiveStdin: true,
        });

        assert.ok(!result.succeeded);
        assert.ok(!JSON.stringify(calls).includes("private-token"));
        assert.ok(!result.error.includes("private-token"));
        assert.strictEqual(child.stdin.read()?.toString(), secret);
    });

    it("preserves complete results under Succeed even when argument diagnostics are masked", async () => {
        const { kubectl } = fakeKubectl(() => fakeChildProcess("partial", "raw stderr", 7));

        const result = await invokeKubectlCommandArgs(
            kubectl,
            "/tmp/kubeconfig",
            ["run", "pod", "private prompt"],
            NonZeroExitCodeBehaviour.Succeed,
            { sensitiveArgs: [2] },
        );

        assert.deepStrictEqual(result, {
            succeeded: true,
            result: { code: 7, stdout: "partial", stderr: "raw stderr" },
        });
    });

    it("releases its listeners when kubectl exits", async () => {
        const child = fakeChildProcess("out", "", 0);
        const { kubectl } = fakeKubectl(() => child);

        await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod"]);

        assert.strictEqual(child.listenerCount("close"), 0);
        assert.strictEqual(child.stdout.listenerCount("data"), 0);
    });

    it("needs no private dependency properties and never falls back to a shell string", async () => {
        const { kubectl, api, spawn } = fakeKubectl(() => fakeChildProcess("out", "", 0));

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod"]);

        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        sinon.assert.notCalled(api.invokeCommand);
        sinon.assert.calledOnce(spawn);
        assert.strictEqual(spawn.firstCall.args[2]?.shell, false);
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

describe("kubectlExecutablePath", () => {
    it("preserves configured Windows .exe paths without quoting or duplicate suffixes", () => {
        for (const configured of [
            "C:\\tools\\kubectl.exe",
            "C:\\tools\\KUBECTL.EXE",
            "C:\\tools\\kubectl.Exe",
            "C:\\Program Files\\kubectl\\kubectl.exe",
            "C:\\Program Files\\kubectl\\KUBECTL.EXE",
            "C:\\Users\\John Smith\\.vs-kubernetes\\tools\\kubectl\\KUBECTL.EXE",
            "C:\\tools\\kubectl.exe.exe",
        ]) {
            assert.strictEqual(kubectlExecutablePath(configured, "win32"), configured);
        }
    });

    it("adds a Windows suffix only when it is missing", () => {
        assert.strictEqual(kubectlExecutablePath("C:\\tools\\kubectl", "win32"), "C:\\tools\\kubectl.exe");
        assert.strictEqual(kubectlExecutablePath("C:\\tools\\kubectl.COM", "win32"), "C:\\tools\\kubectl.COM");
    });

    it("leaves Unix paths unchanged, including literal quotes and .exe.exe filenames", () => {
        for (const file of ["/usr/local/bin/kubectl", '/opt/my tools/"kubectl"', "/opt/tools/kubectl.exe.exe"]) {
            assert.strictEqual(kubectlExecutablePath(file, "linux"), file);
        }
    });

    it("rejects Windows command scripts instead of launching a shell", () => {
        assert.throws(() => kubectlExecutablePath("C:\\tools\\kubectl.cmd", "win32"), /without a shell/);
        assert.throws(() => kubectlExecutablePath("C:\\tools\\kubectl.BAT", "win32"), /without a shell/);
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

    it("hides joined curl request bodies as well as split data arguments", () => {
        for (const arg of [
            "--data=private prompt",
            "--data-raw=private prompt",
            "--data-binary=private prompt",
            "-dprivate prompt",
        ]) {
            assert.ok(!describeKubectlCommand(["run", "pod", "--", "curl", arg]).includes("private prompt"));
        }
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
    afterEach(() => sinon.restore());
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

    afterEach(() => sinon.restore());

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

    it("launches the configured executable exactly once without adding quotes", async () => {
        configureKubectl(bin);
        const spawn = sinon.spy(childProcess, "spawn");
        const kubectl = { api: {} } as k8s.APIAvailable<k8s.KubectlV1>;

        const result = await invokeKubectlCommandArgs(kubectl, "/tmp/kubeconfig", ["get", "pod", "a b; $(x)"]);

        assert.ok(result.succeeded, result.succeeded ? "" : result.error);
        assert.deepStrictEqual(result.result.stdout.trimEnd().split("\n"), [
            "get",
            "pod",
            "a b; $(x)",
            "--kubeconfig",
            "/tmp/kubeconfig",
        ]);
        sinon.assert.calledOnce(spawn);
        assert.strictEqual(spawn.firstCall.args[0], bin);
        assert.strictEqual(spawn.firstCall.args[2]?.shell, false);
    });

    it("reports a missing executable as an error even when nonzero exits are allowed", async () => {
        configureKubectl(path.join(dir, "missing-kubectl"));
        const spawn = sinon.spy(childProcess, "spawn");
        const kubectl = { api: {} } as k8s.APIAvailable<k8s.KubectlV1>;

        const result = await invokeKubectlCommandArgs(
            kubectl,
            "/tmp/kubeconfig",
            ["version"],
            NonZeroExitCodeBehaviour.Succeed,
        );

        assert.ok(!result.succeeded);
        assert.ok(result.error.includes("ENOENT"), result.error);
        sinon.assert.calledOnce(spawn);
    });
});

describe("getExecOutput", () => {
    afterEach(() => sinon.restore());
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
