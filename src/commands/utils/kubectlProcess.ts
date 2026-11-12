import { ChildProcess, spawn } from "child_process";
import { posix, win32 } from "path";
import { ShellResult } from "./shell";

export interface KubectlInvocation {
    readonly executable: string;
    readonly args: string[];
    readonly cwd?: string;
    readonly env: NodeJS.ProcessEnv;
    readonly pipeTo?: { readonly executable: string; readonly args: string[] };
}

export interface KubectlOutputMonitor {
    onStderr(text: string): void;
    onExit(code: number | null): void;
}

// Match the old maxBuffer limit independently for stdout and stderr.
export const MAX_KUBECTL_OUTPUT_BYTES = 20 * 1024 * 1024;

export class KubectlProcessRunner {
    private readonly pending = new Set<() => void>();
    private disposed = false;

    dispose(): void {
        this.disposed = true;
        for (const cancel of this.pending) {
            cancel();
        }
    }

    execute(invocation: KubectlInvocation, stdin?: string, monitor?: KubectlOutputMonitor): Promise<ShellResult> {
        if (this.disposed) {
            return Promise.reject(new Error("The AKS kubectl runner has been disposed."));
        }

        return new Promise<ShellResult>((resolve, reject) => {
            const children: ChildProcess[] = [];
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            let stdoutBytes = 0;
            let stderrBytes = 0;
            let remaining = invocation.pipeTo ? 2 : 1;
            const codes: number[] = [];
            let settled = false;

            const fail = (error: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.pending.delete(cancel);
                stdout.length = 0;
                stderr.length = 0;
                for (const child of children) {
                    child.kill("SIGKILL");
                    child.stdin?.destroy();
                    child.stdout?.destroy();
                    child.stderr?.destroy();
                }
                reject(error);
            };
            const cancel = () => fail(new Error("The AKS kubectl runner has been disposed."));
            this.pending.add(cancel);

            const collect = (chunks: Buffer[], data: Buffer | string) => {
                if (settled) {
                    return;
                }
                const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
                const bytes = chunks === stdout ? (stdoutBytes += chunk.length) : (stderrBytes += chunk.length);
                if (bytes > MAX_KUBECTL_OUTPUT_BYTES) {
                    fail(new Error(`kubectl output exceeded ${MAX_KUBECTL_OUTPUT_BYTES / (1024 * 1024)} MiB.`));
                    return;
                }
                chunks.push(chunk);
            };
            const onStdout = (data: Buffer | string) => collect(stdout, data);
            const onStderr = (data: Buffer | string) => {
                collect(stderr, data);
                if (!settled) {
                    monitor?.onStderr(data.toString());
                }
            };
            const onPipeStderr = (data: Buffer | string) => collect(stderr, data);
            const onStdinError = (error: NodeJS.ErrnoException) => {
                // A command may exit before reading all of its input.
                if (error.code !== "EPIPE") {
                    fail(error);
                }
            };

            const launch = (executable: string, args: string[], index: number) => {
                const child = spawn(executable, args, {
                    cwd: invocation.cwd,
                    env: invocation.env,
                    shell: false,
                    windowsHide: true,
                });
                children.push(child);
                child.on("error", fail);
                child.stdin?.on("error", onStdinError);
                child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
                    child.removeListener("error", fail);
                    child.stdin?.removeListener("error", onStdinError);
                    child.stdout?.removeListener("data", onStdout);
                    child.stderr?.removeListener("data", index === 0 ? onStderr : onPipeStderr);
                    if (index === 0 && !settled) {
                        monitor?.onExit(code);
                    }
                    if (signal) {
                        fail(
                            new Error(
                                `${index === 0 ? "kubectl" : "kubectl output pipe"} terminated by signal ${signal}.`,
                            ),
                        );
                        return;
                    }
                    codes[index] = code ?? 1;
                    remaining--;
                    if (index === 1 && code !== 0 && !settled) {
                        fail(new Error(`kubectl output pipe failed with status ${code ?? 1}.`));
                    }
                    if (remaining === 0 && !settled) {
                        settled = true;
                        this.pending.delete(cancel);
                        resolve({
                            code: codes[0] || codes[1] || 0,
                            stdout: Buffer.concat(stdout).toString("utf8"),
                            stderr: Buffer.concat(stderr).toString("utf8"),
                        });
                    }
                });
                return child;
            };

            try {
                const source = launch(invocation.executable, invocation.args, 0);
                source.stderr?.on("data", onStderr);
                if (invocation.pipeTo) {
                    const sink = launch(invocation.pipeTo.executable, invocation.pipeTo.args, 1);
                    source.stdout?.pipe(sink.stdin!);
                    sink.stdout?.on("data", onStdout);
                    sink.stderr?.on("data", onPipeStderr);
                } else {
                    source.stdout?.on("data", onStdout);
                }
                source.stdin?.end(stdin);
            } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
}

export const kubectlProcessRunner = new KubectlProcessRunner();

/** Keep adjacent kubectl plugins discoverable without changing the host environment. */
export function kubectlEnv(
    file: string,
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
    const result = { ...env };
    const pathKey = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? "PATH";
    const separator = platform === "win32" ? ";" : ":";
    const dir = platform === "win32" ? win32.dirname(file) : posix.dirname(file);
    result[pathKey] = result[pathKey] ? `${dir}${separator}${result[pathKey]}` : dir;
    if (platform === "win32" && !result.HOME) {
        result.HOME = result.HOMEDRIVE && result.HOMEPATH ? result.HOMEDRIVE + result.HOMEPATH : result.USERPROFILE;
    }
    return result;
}
