import * as assert from "assert";
import fs from "fs/promises";
import { Stats } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    getKubectlSettings,
    KubectlSettings,
    kubectlReleaseVersion,
    resolveKubectlInvocation,
} from "../../commands/utils/kubectlExecutable";
import { KubectlInvocation, kubectlProcessRunner } from "../../commands/utils/kubectlProcess";
import * as downloads from "../../commands/utils/helper/binaryDownloadHelper";

function settings(overrides: Partial<KubectlSettings> = {}): KubectlSettings {
    return {
        file: "/opt/my tools/kubectl",
        useWsl: false,
        snap: false,
        inferVersion: false,
        platform: "linux",
        env: { PATH: "/usr/bin" },
        cwd: "/workspace",
        ...overrides,
    };
}

function configure(values: Record<string, unknown>, inspections: Record<string, unknown>) {
    const config = {
        get: (key: string, fallback: unknown) => values[key] ?? fallback,
        inspect: (key: string) => inspections[key],
    } as unknown as vscode.WorkspaceConfiguration;
    sinon.stub(vscode.workspace, "getConfiguration").returns(config);
}

describe("Kubectl settings and executable resolution", () => {
    afterEach(() => sinon.restore());

    it("prefers OS-specific user paths over generic and legacy paths", () => {
        configure(
            {},
            {
                "vscode-kubernetes.kubectl-path-linux": { globalValue: "/linux/kubectl" },
                "vscode-kubernetes.kubectl-path": { globalValue: "/generic/kubectl" },
                "vs-kubernetes": { globalValue: { "vs-kubernetes.kubectl-path.linux": "/legacy/kubectl" } },
            },
        );

        assert.strictEqual(getKubectlSettings("linux").file, "/linux/kubectl");
    });

    it("ignores workspace executable paths, including the legacy nested form", () => {
        configure(
            { "vs-kubernetes": { "vs-kubernetes.kubectl-path": "/workspace/hostile" } },
            {
                "vscode-kubernetes.kubectl-path-linux": { workspaceValue: "/workspace/hostile" },
                "vscode-kubernetes.kubectl-path": { globalValue: "/user/kubectl" },
                "vs-kubernetes": { workspaceValue: { "vs-kubernetes.kubectl-path": "/workspace/hostile" } },
            },
        );

        assert.strictEqual(getKubectlSettings("linux").file, "/user/kubectl");
    });

    it("honors legacy user paths, Snap and automatic version settings", () => {
        configure(
            {
                "vs-kubernetes": {
                    "vs-kubernetes.enable-snap-flag": true,
                    "vs-kubernetes.kubectlVersioning": "infer",
                },
            },
            {
                "vs-kubernetes": { globalValue: { "vs-kubernetes.kubectl-path.mac": "/legacy/kubectl" } },
            },
        );

        const result = getKubectlSettings("darwin");

        assert.strictEqual(result.file, "/legacy/kubectl");
        assert.strictEqual(result.snap, true);
        assert.strictEqual(result.inferVersion, true);
    });

    it("selects the Linux override when WSL is enabled on Windows", () => {
        configure(
            { "vs-kubernetes": { "use-wsl": true } },
            {
                "vscode-kubernetes.kubectl-path-linux": { globalValue: "/linux/kubectl" },
                "vscode-kubernetes.kubectl-path-windows": { globalValue: "C:\\tools\\kubectl.exe" },
            },
        );

        const result = getKubectlSettings("win32");

        assert.strictEqual(result.file, "/linux/kubectl");
        assert.strictEqual(result.useWsl, true);
    });

    it("expands user path variables without executing command substitutions", () => {
        configure(
            {},
            {
                "vscode-kubernetes.kubectl-path": { globalValue: "${env:TOOL_HOME}/${command:doNotRun}/kubectl" },
            },
        );
        const execute = sinon.stub(vscode.commands, "executeCommand");

        assert.strictEqual(
            getKubectlSettings("linux", { TOOL_HOME: "/home/my tools" }).file,
            "/home/my tools/${command:doNotRun}/kubectl",
        );
        sinon.assert.notCalled(execute);
    });

    it("keeps argv and kubeconfig boundaries, cwd and plugin environment intact", async () => {
        const options = settings();
        const args = ["exec", "pod", "--", "printf", "${command:doNotRun};$(marker)"];

        const invocation = await resolveKubectlInvocation("/config/team one", args, options);

        assert.strictEqual(invocation.executable, "/opt/my tools/kubectl");
        assert.deepStrictEqual(invocation.args, [
            "exec",
            "pod",
            "--kubeconfig",
            "/config/team one",
            "--",
            "printf",
            "${command:doNotRun};$(marker)",
        ]);
        assert.strictEqual(invocation.cwd, "/workspace");
        assert.deepStrictEqual(invocation.env, { PATH: "/opt/my tools:/usr/bin", KUBECONFIG: "/config/team one" });
        assert.deepStrictEqual(options.env, { PATH: "/usr/bin" });
        assert.strictEqual(invocation.pipeTo, undefined);
    });

    it("keeps configured Helm and minikube directories available to plugins", async () => {
        const invocation = await resolveKubectlInvocation(
            "/config",
            ["get", "pods"],
            settings({
                otherToolFiles: ["/helm/bin/helm", "/minikube/bin/minikube"],
            }),
        );

        assert.strictEqual(invocation.env.PATH, "/opt/my tools:/minikube/bin:/helm/bin:/usr/bin");
    });

    it("discovers an absolute executable from PATH without searching relative workspace entries", async () => {
        const directory = await fs.mkdtemp(path.join(tmpdir(), "aks-kubectl-path-"));
        const binary = path.join(directory, process.platform === "win32" ? "kubectl.exe" : "kubectl");
        try {
            await fs.writeFile(binary, "fixture", { mode: 0o755 });
            const invocation = await resolveKubectlInvocation(
                "/config",
                ["get", "pods"],
                settings({
                    file: undefined,
                    platform: process.platform,
                    env: { PATH: [".", "relative/bin", directory].join(path.delimiter) },
                }),
            );

            assert.strictEqual(invocation.executable, binary);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it("preserves native Windows Program Files and uppercase .EXE paths", async () => {
        const file = String.raw`C:\Users\John Smith\tools\KUBECTL.EXE`;
        const invocation = await resolveKubectlInvocation(
            "C:\\config",
            ["version"],
            settings({
                file,
                platform: "win32",
                env: { Path: "C:\\Windows", USERPROFILE: "C:\\Users\\John Smith" },
            }),
        );

        assert.strictEqual(invocation.executable, file);
        assert.strictEqual(invocation.env.Path, "C:\\Users\\John Smith\\tools;C:\\Windows");
        assert.strictEqual(invocation.env.HOME, "C:\\Users\\John Smith");
    });

    it("resolves configured command names from an absolute Windows PATH entry", async () => {
        sinon.stub(fs, "access").resolves();
        sinon.stub(fs, "stat").resolves({ isFile: () => true } as Stats);

        const invocation = await resolveKubectlInvocation(
            "C:\\config",
            ["get", "pods"],
            settings({
                file: "KUBECTL.EXE",
                platform: "win32",
                env: { Path: '.;"C:\\Program Files\\Kubernetes";C:\\Windows' },
            }),
        );

        assert.strictEqual(invocation.executable, "C:\\Program Files\\Kubernetes\\KUBECTL.EXE");
    });

    it("adds a shell-free output copier only when Snap compatibility is enabled", async () => {
        const invocation = await resolveKubectlInvocation("/config", ["get", "pods"], settings({ snap: true }));

        assert.deepStrictEqual(invocation.pipeTo, { executable: "cat", args: [] });
    });

    it("routes WSL through the system executable and translates host kubeconfig paths as argv", async () => {
        const execute = sinon.stub(kubectlProcessRunner, "execute").callsFake(async (invocation) => ({
            code: 0,
            stdout: invocation.args[1] === "wslpath" ? "/mnt/c/team one/config\n" : "/usr/local/bin:/usr/bin\n",
            stderr: "",
        }));
        const invocation = await resolveKubectlInvocation(
            String.raw`C:\team one\config`,
            ["exec", "pod", "--", "ls"],
            settings({
                file: "/opt/my tools/kubectl",
                platform: "win32",
                useWsl: true,
                snap: true,
                env: { SystemRoot: "C:\\Windows" },
            }),
        );

        assert.ok(execute.args.every(([probe]) => probe.executable === "C:\\Windows\\System32\\wsl.exe"));
        assert.deepStrictEqual(execute.firstCall.args[0].args, [
            "--exec",
            "wslpath",
            "-a",
            "-u",
            String.raw`C:\team one\config`,
        ]);
        assert.deepStrictEqual(invocation.args, [
            "--exec",
            "env",
            "PATH=/opt/my tools:/usr/local/bin:/usr/bin",
            "KUBECONFIG=/mnt/c/team one/config",
            "/opt/my tools/kubectl",
            "exec",
            "pod",
            "--kubeconfig",
            "/mnt/c/team one/config",
            "--",
            "ls",
        ]);
        assert.deepStrictEqual(invocation.pipeTo, {
            executable: "C:\\Windows\\System32\\wsl.exe",
            args: ["--exec", "cat"],
        });
    });

    it("leaves already-guest paths unchanged, including literal backslashes", async () => {
        const execute = sinon
            .stub(kubectlProcessRunner, "execute")
            .resolves({ code: 0, stdout: "/usr/bin\n", stderr: "" });
        const config = String.raw`/home/user/team\one/config`;

        const invocation = await resolveKubectlInvocation(
            config,
            ["get", "pods"],
            settings({
                useWsl: true,
                platform: "win32",
                env: { SystemRoot: "C:\\Windows" },
            }),
        );

        sinon.assert.calledOnce(execute);
        assert.ok(invocation.args.includes(config));
    });

    it("uses the default WSL shell's PATH without placing tool names or arguments in its script", async () => {
        const execute = sinon.stub(kubectlProcessRunner, "execute").callsFake(async (probe) => ({
            code: 0,
            stdout: probe.args[1] === "sh" ? "/home/user/custom/bin:/usr/bin\n" : "/home/user/custom/bin/kubectl\n",
            stderr: "",
        }));

        const invocation = await resolveKubectlInvocation(
            "/home/user/config",
            ["get", "pods", "$(marker)"],
            settings({
                file: undefined,
                useWsl: true,
                platform: "win32",
                env: { SystemRoot: "C:\\Windows" },
            }),
        );

        assert.deepStrictEqual(execute.firstCall.args[0].args, [
            "--exec",
            "sh",
            "-c",
            "exec \"${SHELL:-/bin/sh}\" -c 'printenv PATH'",
        ]);
        assert.deepStrictEqual(execute.secondCall.args[0].args, [
            "--exec",
            "env",
            "PATH=/home/user/custom/bin:/usr/bin",
            "which",
            "kubectl",
        ]);
        assert.ok(invocation.args.includes("/home/user/custom/bin/kubectl"));
        assert.ok(invocation.args.includes("$(marker)"));
        assert.ok(execute.args.every(([probe]) => !probe.args.some((arg) => arg.includes("$(marker)"))));
    });

    it("does not search a workspace for wsl.exe when the system path is unavailable", async () => {
        const execute = sinon.stub(kubectlProcessRunner, "execute");

        await assert.rejects(
            () =>
                resolveKubectlInvocation(
                    "/config",
                    ["version"],
                    settings({
                        useWsl: true,
                        platform: "win32",
                        env: {},
                    }),
                ),
            /system WSL executable/,
        );
        sinon.assert.notCalled(execute);
    });

    it("selects a matching release using the target kubeconfig and preserves auth monitoring", async () => {
        const execute = sinon.stub(kubectlProcessRunner, "execute").resolves({
            code: 0,
            stdout: JSON.stringify({ serverVersion: { gitVersion: "v1.34.2" } }),
            stderr: "",
        });
        const download = sinon
            .stub(downloads, "getToolBinaryPath")
            .resolves({ succeeded: true, result: "/cache/kubectl" });
        const monitor = { onStderr: sinon.spy(), onExit: sinon.spy() };
        const createMonitor = sinon.stub().returns(monitor);

        const invocation = await resolveKubectlInvocation(
            "/config/team",
            ["get", "pods"],
            settings({ inferVersion: true }),
            createMonitor,
        );

        assert.strictEqual(invocation.executable, "/cache/kubectl");
        assert.deepStrictEqual(execute.firstCall.args[0].args, [
            "version",
            "-o",
            "json",
            "--kubeconfig",
            "/config/team",
        ]);
        assert.strictEqual(execute.firstCall.args[2], monitor);
        sinon.assert.calledOnce(createMonitor);
        const arch = process.arch === "x64" ? "amd64" : process.arch;
        sinon.assert.calledOnceWithExactly(download, "kubectl", `linux-${arch}/v1.34.2`, "kubectl", {
            isCompressed: false,
            downloadUrl: `https://dl.k8s.io/release/v1.34.2/bin/linux/${arch}/kubectl`,
        });
    });

    it("does not use invalid cluster versions in a download or filesystem write", async () => {
        const execute = sinon.stub(kubectlProcessRunner, "execute");
        const download = sinon.stub(downloads, "getToolBinaryPath");
        for (const value of ["../../other", "https://example.com", "v1.34.2/../../../other", "v1.34.2;whoami", null]) {
            execute.resolves({ code: 0, stdout: JSON.stringify({ serverVersion: { gitVersion: value } }), stderr: "" });
            const invocation = await resolveKubectlInvocation(
                "/config",
                ["get", "pods"],
                settings({ inferVersion: true }),
            );
            assert.strictEqual(invocation.executable, "/opt/my tools/kubectl");
        }
        sinon.assert.notCalled(download);
    });

    it("keeps official prerelease tags and rejects invalid release values", () => {
        assert.strictEqual(kubectlReleaseVersion("v1.35.0-beta.2"), "v1.35.0-beta.2");
        assert.strictEqual(kubectlReleaseVersion("1.34.2"), "v1.34.2");
        assert.throws(() => kubectlReleaseVersion({ gitVersion: "v1.34.2" }), /invalid/);
    });

    it("keeps the selected client after a failed version probe without starting a download", async () => {
        sinon.stub(kubectlProcessRunner, "execute").resolves({ code: 9, stdout: "", stderr: "Forbidden" });
        const download = sinon.stub(downloads, "getToolBinaryPath");

        const invocation = await resolveKubectlInvocation("/config", ["get", "pods"], settings({ inferVersion: true }));

        assert.strictEqual(invocation.executable, "/opt/my tools/kubectl");
        assert.deepStrictEqual(invocation.args, ["get", "pods", "--kubeconfig", "/config"]);
        sinon.assert.notCalled(download);
    });

    it("keeps the selected client when a matching release cannot be downloaded", async () => {
        sinon.stub(kubectlProcessRunner, "execute").resolves({
            code: 0,
            stdout: JSON.stringify({ serverVersion: { gitVersion: "v1.34.2" } }),
            stderr: "",
        });
        sinon
            .stub(downloads, "getToolBinaryPath")
            .resolves({ succeeded: false, error: "Download failed with HTTP 404." });

        const invocation = await resolveKubectlInvocation("/config", ["get", "pods"], settings({ inferVersion: true }));

        assert.strictEqual(invocation.executable, "/opt/my tools/kubectl");
    });

    it("uses an existing cached client to bootstrap automatic selection when PATH is empty", async () => {
        sinon.stub(fs, "readdir").resolves(["v1.31.0", "v1.34.0", "not-a-version"] as never);
        sinon.stub(fs, "access").resolves();
        sinon.stub(fs, "stat").resolves({ isFile: () => true } as Stats);
        const execute = sinon.stub(kubectlProcessRunner, "execute").resolves({
            code: 0,
            stdout: JSON.stringify({ serverVersion: { gitVersion: "v1.34.2" } }),
            stderr: "",
        });
        sinon.stub(downloads, "getToolBinaryPath").resolves({ succeeded: true, result: "/cache/matching-kubectl" });
        const fetchRelease = sinon.stub(globalThis, "fetch");

        const invocation = await resolveKubectlInvocation(
            "/config",
            ["get", "pods"],
            settings({
                file: undefined,
                inferVersion: true,
                env: {},
            }),
        );

        assert.ok(execute.firstCall.args[0].executable.endsWith(path.join("v1.34.0", "kubectl")));
        assert.strictEqual(invocation.executable, "/cache/matching-kubectl");
        sinon.assert.notCalled(fetchRelease);
    });

    it("can bootstrap a missing client using the stable release before matching the server", async () => {
        sinon.stub(fs, "readdir").rejects(Object.assign(new Error("missing cache"), { code: "ENOENT" }));
        const fetchRelease = sinon.stub(globalThis, "fetch").resolves(new Response("v1.34.0\n"));
        sinon.stub(kubectlProcessRunner, "execute").resolves({
            code: 0,
            stdout: JSON.stringify({ serverVersion: { gitVersion: "v1.34.2" } }),
            stderr: "",
        });
        const download = sinon.stub(downloads, "getToolBinaryPath");
        download.onFirstCall().resolves({ succeeded: true, result: "/cache/bootstrap" });
        download.onSecondCall().resolves({ succeeded: true, result: "/cache/matching" });

        const invocation = await resolveKubectlInvocation(
            "/config",
            ["get", "pods"],
            settings({
                file: undefined,
                inferVersion: true,
                env: {},
            }),
        );

        sinon.assert.calledOnceWithExactly(fetchRelease, "https://dl.k8s.io/release/stable.txt");
        sinon.assert.calledTwice(download);
        assert.strictEqual(invocation.executable, "/cache/matching");
    });

    it("reports stable-release HTTP failures without trying to execute their response", async () => {
        sinon.stub(fs, "readdir").rejects(Object.assign(new Error("missing cache"), { code: "ENOENT" }));
        sinon.stub(globalThis, "fetch").resolves(new Response("not found", { status: 404 }));
        const execute = sinon.stub(kubectlProcessRunner, "execute");
        const download = sinon.stub(downloads, "getToolBinaryPath");

        await assert.rejects(
            () =>
                resolveKubectlInvocation(
                    "/config",
                    ["version"],
                    settings({
                        file: undefined,
                        inferVersion: true,
                        env: {},
                    }),
                ),
            /HTTP 404/,
        );
        sinon.assert.notCalled(execute);
        sinon.assert.notCalled(download);
    });

    it("uses the guest architecture when selecting a WSL client", async () => {
        const probes: KubectlInvocation[] = [];
        sinon.stub(kubectlProcessRunner, "execute").callsFake(async (invocation) => {
            probes.push(invocation);
            const command = invocation.args[1];
            const stdout =
                command === "uname"
                    ? "aarch64\n"
                    : command === "sh"
                      ? "/usr/bin\n"
                      : command === "wslpath"
                        ? "/mnt/c/cache/kubectl\n"
                        : command === "env"
                          ? JSON.stringify({ serverVersion: { gitVersion: "v1.34.2" } })
                          : "";
            return { code: 0, stdout, stderr: "" };
        });
        const download = sinon.stub(downloads, "getToolBinaryPath").resolves({
            succeeded: true,
            result: "C:\\cache\\kubectl",
        });

        const invocation = await resolveKubectlInvocation(
            "/home/user/config",
            ["get", "pods"],
            settings({
                file: "/usr/bin/kubectl",
                useWsl: true,
                inferVersion: true,
                platform: "win32",
                env: { SystemRoot: "C:\\Windows" },
            }),
        );

        assert.strictEqual(download.firstCall.args[1], "linux-arm64/v1.34.2");
        assert.ok(invocation.args.includes("/mnt/c/cache/kubectl"));
        assert.ok(probes.some((probe) => probe.args.join(" ") === "--exec chmod 0755 /mnt/c/cache/kubectl"));
    });
});
