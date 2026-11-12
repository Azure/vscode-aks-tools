import * as fs from "fs/promises";
import { constants } from "fs";
import { homedir } from "os";
import * as path from "path";
import * as semver from "semver";
import * as vscode from "vscode";
import { failed } from "./errorable";
import { getToolBinaryPath } from "./helper/binaryDownloadHelper";
import { KubectlInvocation, KubectlOutputMonitor, kubectlEnv, kubectlProcessRunner } from "./kubectlProcess";

export interface KubectlSettings {
    readonly file?: string;
    readonly useWsl: boolean;
    readonly snap: boolean;
    readonly inferVersion: boolean;
    readonly platform: NodeJS.Platform;
    readonly env: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly otherToolFiles?: readonly string[];
}

export function getKubectlSettings(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): KubectlSettings {
    const config = vscode.workspace.getConfiguration();
    const legacy = config.get<Record<string, unknown>>("vs-kubernetes", {});
    const useWsl = platform === "win32" && legacy["use-wsl"] === true;
    const os = useWsl || platform === "linux" ? "linux" : platform === "win32" ? "windows" : "mac";
    const file = userToolPath("kubectl", os, config);
    const otherToolFiles = ["helm", "minikube"].flatMap((tool) => {
        const configured = userToolPath(tool, os, config);
        return configured ? [expandKubectlPath(configured, env, config)] : [];
    });

    return {
        file: file ? expandKubectlPath(file, env, config) : undefined,
        useWsl,
        snap: legacy["vs-kubernetes.enable-snap-flag"] === true,
        inferVersion: legacy["vs-kubernetes.kubectlVersioning"] === "infer",
        platform,
        env: { ...env },
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        otherToolFiles,
    };
}

function userToolPath(tool: string, os: string, config: vscode.WorkspaceConfiguration): string | undefined {
    const old = config.inspect<Record<string, unknown>>("vs-kubernetes");
    // Executable paths must come from user settings, never from a workspace.
    for (const key of [`vscode-kubernetes.${tool}-path-${os}`, `vscode-kubernetes.${tool}-path`]) {
        const setting = config.inspect<string>(key);
        const value =
            old?.globalValue?.[key] || old?.defaultValue?.[key] || setting?.globalValue || setting?.defaultValue;
        if (typeof value === "string" && value) {
            return value;
        }
    }
    for (const key of [`vs-kubernetes.${tool}-path.${os}`, `vs-kubernetes.${tool}-path`]) {
        const value = old?.globalValue?.[key] || old?.defaultValue?.[key];
        if (typeof value === "string" && value) {
            return value;
        }
    }
    return undefined;
}

export function kubectlExecutablePath(file: string, platform: NodeJS.Platform): string {
    if (platform !== "win32") {
        return file;
    }
    if (/\.(cmd|bat)$/i.test(file)) {
        throw new Error("Configure a kubectl.exe path, not a Windows command script, to run kubectl without a shell.");
    }
    return /\.(exe|com)$/i.test(file) ? file : `${file}.exe`;
}

export async function resolveKubectlInvocation(
    kubeConfigFile: string,
    args: string[],
    settings: KubectlSettings = getKubectlSettings(),
    monitor?: () => KubectlOutputMonitor,
): Promise<KubectlInvocation> {
    const { env, cwd } = settings;
    const pathsApi = settings.platform === "win32" ? path.win32 : path.posix;
    if (
        settings.file &&
        !pathsApi.isAbsolute(settings.file) &&
        !(settings.useWsl && path.posix.isAbsolute(settings.file)) &&
        /[\\/]/.test(settings.file)
    ) {
        throw new Error("Configure an absolute executable path or an executable name on PATH, not a relative path.");
    }
    let configPath = kubeConfigFile;
    let guestPath: string | undefined;
    let wsl: string | undefined;

    const guest = async (command: string[]): Promise<string> => {
        const result = await kubectlProcessRunner.execute({ executable: wsl!, args: ["--exec", ...command], env, cwd });
        if (result.code !== 0) {
            throw new Error(`Unable to run WSL ${command[0]} (status ${result.code}).`);
        }
        return result.stdout.trimEnd();
    };
    const toGuestPath = async (file: string) => (file.startsWith("/") ? file : guest(["wslpath", "-a", "-u", file]));

    if (settings.useWsl) {
        const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir;
        if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
            throw new Error("Unable to locate the Windows system WSL executable.");
        }
        wsl = path.win32.join(systemRoot, "System32", "wsl.exe");
        configPath = await toGuestPath(kubeConfigFile);
        // Match legacy WSL PATH setup without passing any kubectl arguments to a shell.
        guestPath = await guest(["sh", "-c", "exec \"${SHELL:-/bin/sh}\" -c 'printenv PATH'"]);
        for (const tool of settings.otherToolFiles ?? []) {
            if (path.posix.isAbsolute(tool) || path.win32.isAbsolute(tool)) {
                guestPath = `${path.posix.dirname(await toGuestPath(tool))}:${guestPath}`;
            }
        }
    }

    const invocation = (file: string, command: string[]): KubectlInvocation => {
        const separator = command.indexOf("--");
        const at = separator === -1 ? command.length : separator;
        const fullArgs = [...command.slice(0, at), "--kubeconfig", configPath, ...command.slice(at)];
        if (wsl) {
            return {
                executable: wsl,
                args: [
                    "--exec",
                    "env",
                    `PATH=${path.posix.dirname(file)}:${guestPath}`,
                    `KUBECONFIG=${configPath}`,
                    file,
                    ...fullArgs,
                ],
                cwd,
                env,
                pipeTo: settings.snap ? { executable: wsl, args: ["--exec", "cat"] } : undefined,
            };
        }
        let runEnv: NodeJS.ProcessEnv = { ...env, KUBECONFIG: configPath };
        for (const tool of settings.otherToolFiles ?? []) {
            if (pathsApi.isAbsolute(tool)) {
                runEnv = kubectlEnv(tool, runEnv, settings.platform);
            }
        }
        return {
            executable: file,
            args: fullArgs,
            cwd,
            env: kubectlEnv(file, runEnv, settings.platform),
            pipeTo: settings.snap ? { executable: "cat", args: [] } : undefined,
        };
    };

    let file: string | undefined;
    if (wsl) {
        file =
            settings.file && (settings.file.includes("/") || settings.file.includes("\\"))
                ? await toGuestPath(settings.file)
                : undefined;
        if (!file) {
            try {
                file = (await guest(["env", `PATH=${guestPath}`, "which", settings.file ?? "kubectl"])).split(
                    /\r?\n/,
                )[0];
            } catch {
                // Automatic version selection can bootstrap a missing kubectl.
            }
        }
    } else {
        const configured = settings.file ? kubectlExecutablePath(settings.file, settings.platform) : undefined;
        if (configured && pathsApi.isAbsolute(configured)) {
            file = configured;
        } else {
            file = await findNativeKubectl(settings, configured);
        }
    }

    const platform = settings.useWsl ? "linux" : settings.platform === "win32" ? "windows" : settings.platform;
    if (platform !== "linux" && platform !== "darwin" && platform !== "windows") {
        throw new Error(`Unsupported kubectl platform: ${platform}.`);
    }
    let arch: string = process.arch === "x64" ? "amd64" : process.arch;
    if (settings.inferVersion && wsl) {
        const machine = await guest(["uname", "-m"]);
        arch = machine === "x86_64" ? "amd64" : machine === "aarch64" ? "arm64" : machine;
    }
    const downloadBinary = async (version: string) => {
        const downloaded = await downloadedKubectl(version, platform, arch);
        if (!wsl) {
            return downloaded;
        }
        const guestFile = await toGuestPath(downloaded);
        await guest(["chmod", "0755", guestFile]);
        return guestFile;
    };

    if (!file && settings.inferVersion) {
        file = await cachedKubectl(platform, arch);
        if (file && wsl) {
            file = await toGuestPath(file);
        }
        if (!file) {
            const response = await fetch("https://dl.k8s.io/release/stable.txt");
            if (!response.ok) {
                throw new Error(`Unable to determine the default kubectl version (HTTP ${response.status}).`);
            }
            file = await downloadBinary(kubectlReleaseVersion(await response.text()));
        }
    }
    if (!file) {
        throw new Error(
            "kubectl was not found. Configure the Kubernetes extension's kubectl path or install kubectl on PATH.",
        );
    }

    if (settings.inferVersion) {
        try {
            const result = await kubectlProcessRunner.execute(
                invocation(file, ["version", "-o", "json"]),
                undefined,
                monitor?.(),
            );
            if (result.code === 0) {
                const version: unknown = JSON.parse(result.stdout);
                if (typeof version === "object" && version !== null && "serverVersion" in version) {
                    const server = version.serverVersion;
                    if (typeof server === "object" && server !== null && "gitVersion" in server) {
                        file = await downloadBinary(kubectlReleaseVersion(server.gitVersion));
                    }
                }
            }
        } catch {
            // Match the existing inference fallback, keeping the already selected client pinned.
        }
    }

    return invocation(file, args);
}

export function kubectlReleaseVersion(value: unknown): string {
    if (typeof value !== "string") {
        throw new Error("kubectl returned an invalid Kubernetes version.");
    }
    const version = semver.parse(value.trim());
    if (!version) {
        throw new Error("kubectl returned an invalid Kubernetes version.");
    }
    return `v${version.version}`;
}

async function findNativeKubectl(settings: KubectlSettings, configuredName?: string): Promise<string | undefined> {
    const pathKey = Object.keys(settings.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    const paths = settings.env[pathKey]?.split(settings.platform === "win32" ? ";" : ":") ?? [];
    const pathsApi = settings.platform === "win32" ? path.win32 : path.posix;
    for (const directory of paths) {
        const absolute =
            settings.platform === "win32" && directory.startsWith('"') && directory.endsWith('"')
                ? directory.slice(1, -1)
                : directory;
        if (!pathsApi.isAbsolute(absolute)) {
            continue;
        }
        const file = pathsApi.join(
            absolute,
            configuredName ?? (settings.platform === "win32" ? "kubectl.exe" : "kubectl"),
        );
        if (await isExecutable(file, settings.platform)) {
            return file;
        }
    }
    return undefined;
}

async function isExecutable(file: string, platform: NodeJS.Platform): Promise<boolean> {
    try {
        await fs.access(file, platform === "win32" ? constants.F_OK : constants.X_OK);
        return (await fs.stat(file)).isFile();
    } catch (error) {
        if (["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) {
            return false;
        }
        throw error;
    }
}

async function cachedKubectl(platform: string, arch: string): Promise<string | undefined> {
    const base = path.join(homedir(), ".vs-kubernetes", "tools", "kubectl");
    for (const directory of [path.join(base, `${platform}-${arch}`), path.join(base, "autoversion")]) {
        let entries: string[];
        try {
            entries = await fs.readdir(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                continue;
            }
            throw error;
        }
        const versions = entries.filter((entry) => semver.valid(entry));
        versions.sort(semver.rcompare);
        for (const version of versions) {
            const file = path.join(directory, version, platform === "windows" ? "kubectl.exe" : "kubectl");
            if (await isExecutable(file, platform === "windows" ? "win32" : process.platform)) {
                return file;
            }
        }
    }
    return undefined;
}

// The shared downloader uses one staging filename per tool, so serialize kubectl downloads.
let downloadQueue: Promise<void> = Promise.resolve();

async function downloadedKubectl(version: string, platform: string, arch: string): Promise<string> {
    if (!["amd64", "arm64", "arm"].includes(arch)) {
        throw new Error(`Unsupported kubectl architecture: ${arch}.`);
    }
    const binary = platform === "windows" ? "kubectl.exe" : "kubectl";
    const operation = downloadQueue.then(() =>
        getToolBinaryPath("kubectl", `${platform}-${arch}/${version}`, binary, {
            isCompressed: false,
            downloadUrl: `https://dl.k8s.io/release/${version}/bin/${platform}/${arch}/${binary}`,
        }),
    );
    downloadQueue = operation.then(
        () => {},
        () => {},
    );
    const result = await operation;
    if (failed(result)) {
        throw new Error(result.error);
    }
    return result.result;
}

function expandKubectlPath(value: string, env: NodeJS.ProcessEnv, config: vscode.WorkspaceConfiguration): string {
    return value.replace(/\$\{([^}]+)\}/g, (original, name: string) => {
        if (name.startsWith("env:")) {
            return env[name.slice(4)] ?? "";
        }
        if (name.startsWith("config:")) {
            const key = name.slice(7);
            const setting = config.inspect<string>(key);
            const configured = setting?.globalValue ?? setting?.defaultValue;
            if (typeof configured !== "string") {
                throw new Error(`Executable path setting '${key}' must have a user or default string value.`);
            }
            return configured;
        }
        if (name === "userHome") {
            return homedir();
        }
        if (name === "pathSeparator") {
            return path.sep;
        }
        throw new Error(`Unsupported variable '${original}' in executable path.`);
    });
}
