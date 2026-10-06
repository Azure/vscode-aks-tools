import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { Errorable, failed, getErrorMessage, map } from "./errorable";
import { OutputStream } from "./commands";
import { Observable, concat, of } from "rxjs";
import { NonZeroExitCodeBehaviour } from "./shell";
import { ChildProcess, spawn } from "child_process";
import * as vscode from "vscode";
import { l10n } from "vscode";

export type K8sVersion = {
    major: string;
    minor: string;
    gitVersion: string;
    buildDate: string;
};

export type KubectlVersion = {
    clientVersion: K8sVersion;
    serverVersion: K8sVersion;
};

export function getVersion(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
): Promise<Errorable<KubectlVersion>> {
    return getKubectlJsonResult(kubectl, kubeConfigFile, ["version", "-o", "json"]);
}

export async function getExecOutput(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    namespace: string,
    pod: string,
    podArgs: string[],
): Promise<Errorable<KubectlV1.ShellResult>> {
    return invokeKubectlPodCommandArgs(kubectl, kubeConfigFile, ["exec", "-n", namespace, pod, "--", ...podArgs]);
}

/** Like `invokeKubectlCommandArgs`, with `--kubeconfig` first for commands that use "--". */
export async function invokeKubectlPodCommandArgs(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    args: string[],
    exitCodeBehaviour?: NonZeroExitCodeBehaviour,
): Promise<Errorable<KubectlV1.ShellResult>> {
    return runKubectl(
        kubectl,
        ["--kubeconfig", kubeConfigFile, ...args],
        `kubectl ${args.join(" ")}`,
        exitCodeBehaviour ?? NonZeroExitCodeBehaviour.Fail,
    );
}

/**
 * Runs kubectl with an argument array and no shell, so values carried in `args` cannot be
 * interpreted as commands. Use this for every kubectl call; see development.md for the
 * few exceptions.
 */
export async function invokeKubectlCommandArgs(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    args: string[],
    exitCodeBehaviour?: NonZeroExitCodeBehaviour,
): Promise<Errorable<KubectlV1.ShellResult>> {
    // kubeconfig goes last: kubectl plugins do not accept it before the plugin name.
    return runKubectl(
        kubectl,
        [...args, "--kubeconfig", kubeConfigFile],
        `kubectl ${args.join(" ")}`,
        exitCodeBehaviour ?? NonZeroExitCodeBehaviour.Fail,
    );
}

async function runKubectl(
    kubectl: APIAvailable<KubectlV1>,
    fullArgs: string[],
    description: string,
    behaviour: NonZeroExitCodeBehaviour,
): Promise<Errorable<KubectlV1.ShellResult>> {
    const internal = asInternal(kubectl.api);

    if (failed(internal)) {
        return { succeeded: false, error: `Failed to run "${description}": ${internal.error}` };
    }

    if (internal.result.legacySpawnAsChild === undefined) {
        // Never fall back to the string form: joining these values back into one line would
        // hand them to a shell, which is the thing the argument array exists to prevent.
        // observeCommand also takes an array and spawns without a shell, at the cost of
        // stderr and the exact exit code.
        return invokeViaObservedCommand(internal.result, fullArgs, description, behaviour);
    }

    try {
        const child = await internal.result.legacySpawnAsChild(fullArgs);
        if (child === undefined) {
            return { succeeded: false, error: `Failed to run "${description}": kubectl could not be started.` };
        }

        const result = await readChildProcess(respawnIfQuotedPath(child, fullArgs));
        if (result.code !== 0 && behaviour === NonZeroExitCodeBehaviour.Fail) {
            return {
                succeeded: false,
                error: `The command "${description}" returned status code ${result.code}\nError: ${result.stderr}`,
            };
        }

        return { succeeded: true, result };
    } catch (e) {
        return { succeeded: false, error: `Error running "${description}":\n${getErrorMessage(e)}` };
    }
}

/**
 * Fallback for a kubernetes-tools without `legacySpawnAsChild`. Still argument-array based
 * and still shell-free; it only reports a coarser result, because the observable completes
 * on success and errors on failure without surfacing the exit code or stderr separately.
 */
function invokeViaObservedCommand(
    internal: KubectlInternal,
    args: string[],
    description: string,
    behaviour: NonZeroExitCodeBehaviour,
): Promise<Errorable<KubectlV1.ShellResult>> {
    return new Promise<Errorable<KubectlV1.ShellResult>>((resolve) => {
        internal
            .observeCommand(args)
            .then((runningProcess) => {
                const lines: string[] = [];
                runningProcess.lines.subscribe({
                    next: (line) => lines.push(line),
                    error: (e) => {
                        const stderr = getErrorMessage(e);
                        if (behaviour === NonZeroExitCodeBehaviour.Succeed) {
                            resolve({ succeeded: true, result: { code: 1, stdout: lines.join("\n"), stderr } });
                            return;
                        }
                        resolve({ succeeded: false, error: `The command "${description}" failed\nError: ${stderr}` });
                    },
                    complete: () =>
                        resolve({ succeeded: true, result: { code: 0, stdout: lines.join("\n"), stderr: "" } }),
                });
            })
            .catch((e) =>
                resolve({ succeeded: false, error: `Error running "${description}":\n${getErrorMessage(e)}` }),
            );
    });
}

// legacySpawnAsChild quotes kubectl paths containing spaces, so the launch fails with
// ENOENT. Relaunch with the unquoted path.
function respawnIfQuotedPath(child: ChildProcess, args: string[]): ChildProcess {
    const file = child.spawnfile;
    if (typeof file !== "string" || file.length < 2 || !file.startsWith('"') || !file.endsWith('"')) {
        return child;
    }

    child.on("error", () => {}); // expected ENOENT
    return spawn(file.slice(1, -1), args, { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
}

function readChildProcess(child: ChildProcess): Promise<KubectlV1.ShellResult> {
    return new Promise<KubectlV1.ShellResult>((resolve, reject) => {
        // Decode once at the end so multi-byte characters split across chunks stay intact.
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const authMonitor = createAuthPromptMonitor();

        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr.push(chunk);
            authMonitor.onStderr(chunk.toString());
        });
        child.on("error", reject);
        // `code` is null when the process was killed by a signal; report that as a failure
        // rather than as a success, which a 0 default would imply.
        child.on("close", (code) => {
            authMonitor.onExit(code);
            // legacySpawnAsChild keeps every child it starts, so release our listeners and output.
            child.removeAllListeners();
            child.stdout?.removeAllListeners();
            child.stderr?.removeAllListeners();
            resolve({
                code: code ?? 1,
                stdout: Buffer.concat(stdout).toString(),
                stderr: Buffer.concat(stderr).toString(),
            });
        });
    });
}

// Azure AD device login URLs, as matched by vscode-kubernetes-tools.
const AUTH_PROMPT_PATTERN =
    /https:\/\/(?:[a-z0-9-]+\.)?microsoft(?:online)?\.com\/(?:device|devicelogin|common\/oauth2\/deviceauth)/i;

let authNotificationShown = false;

/** Shows device login prompts from stderr while kubectl is still running. */
export function createAuthPromptMonitor(): { onStderr(text: string): void; onExit(code: number | null): void } {
    let pending = "";
    let promptDetected = false;

    return {
        onStderr(text: string) {
            pending += text;
            let newlineIndex = pending.indexOf("\n");
            while (newlineIndex !== -1) {
                const line = pending.slice(0, newlineIndex).trim();
                pending = pending.slice(newlineIndex + 1);
                if (AUTH_PROMPT_PATTERN.test(line) && !authNotificationShown) {
                    authNotificationShown = true;
                    promptDetected = true;
                    vscode.window.showWarningMessage(l10n.t("Authentication required: {0}", line));
                    // Show one prompt for concurrent calls.
                    setTimeout(() => (authNotificationShown = false), 1000);
                }
                newlineIndex = pending.indexOf("\n");
            }
        },
        onExit(code: number | null) {
            if (promptDetected && code === 0) {
                vscode.window.showInformationMessage(
                    l10n.t("Authentication successful. You may need to refresh or retry your last action."),
                );
            }
        },
    };
}

export async function getKubectlJsonResult<T>(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    args: string[],
): Promise<Errorable<T>> {
    const shellResult = await invokeKubectlCommandArgs(kubectl, kubeConfigFile, args);
    if (failed(shellResult)) {
        return shellResult;
    }

    const output = shellResult.result.stdout.trim();
    try {
        return { succeeded: true, result: JSON.parse(output) as T };
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to parse command output as JSON:\n\tError: ${e}\n\tCommand: ${args.join(" ")}\n\tOutput: ${output}`,
        };
    }
}

export enum NamespaceType {
    NotNamespaced,
    AllNamespaces,
}

export async function getResources<T>(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    resourceName: string,
    namespace: string | NamespaceType,
    labels: { [label: string]: string } = {},
): Promise<Errorable<T[]>> {
    let namespaceFlags: string[];
    switch (namespace) {
        case NamespaceType.AllNamespaces:
            namespaceFlags = ["-A"];
            break;
        case NamespaceType.NotNamespaced:
            namespaceFlags = [];
            break;
        default:
            namespaceFlags = ["-n", namespace];
            break;
    }

    const labelFlags = Object.keys(labels).flatMap((l) => ["-l", `${l}=${labels[l]}`]);

    const args = ["get", resourceName, ...namespaceFlags, ...labelFlags, "-o", "json"];

    const listResult = await getKubectlJsonResult<K8sList<T>>(kubectl, kubeConfigFile, args);
    return map(listResult, (r) => r.items);
}

interface K8sList<T> {
    items: T[];
}

export async function streamKubectlOutput(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    kubectlArgs: string[],
): Promise<Errorable<OutputStream>> {
    const kubectlInternal = asInternal(kubectl.api);
    if (failed(kubectlInternal)) {
        return kubectlInternal;
    }

    // If part of the command is a plugin, the kubeconfig argument must be placed after that,
    // so we add it at the end here.
    const args = [...kubectlArgs, "--kubeconfig", kubeConfigFile];
    const runningProcess = await kubectlInternal.result.observeCommand(args);

    return new Promise<Errorable<OutputStream>>((resolve) => {
        // Wait until there's some output or an error before completing
        let running = false;
        runningProcess.lines.subscribe({
            next: (line) => {
                if (!running) {
                    running = true;
                    const observable = concat(of(line), runningProcess.lines);
                    const disposable = new OutputStream(() => runningProcess.terminate(), observable);
                    resolve({ succeeded: true, result: disposable });
                }
            },
            error: (e) =>
                resolve({
                    succeeded: false,
                    error: `Failed to run 'kubectl ${args.join(" ")}': ${getErrorMessage(e)}`,
                }),
            complete: () => resolve({ succeeded: true, result: new OutputStream(() => {}, new Observable()) }),
        });
    });
}

function asInternal(api: KubectlV1): Errorable<KubectlInternal> {
    if (!("kubectl" in api)) {
        return { succeeded: false, error: "Internal kubectl property not available in KubectlV1 API." };
    }

    const result = api.kubectl as KubectlInternal;
    return { succeeded: true, result };
}

interface KubectlInternal {
    observeCommand(args: string[]): Promise<RunningProcess>;
    /**
     * Spawns kubectl with an argument array and no shell, returning the child process so
     * stdout, stderr and the exit code are all available. Not part of the published
     * KubectlV1 surface, so treat it as optional and fall back when it is missing.
     */
    legacySpawnAsChild?(args: string[]): Promise<ChildProcess | undefined>;
}

interface RunningProcess {
    readonly lines: Observable<string>;
    terminate(): void;
}

/**
 * Splits a kubectl command line the user typed into an argument array, honouring single
 * and double quotes. Nothing is interpreted: the result goes to `invokeKubectlCommandArgs`,
 * which spawns without a shell, so metacharacters in the input are inert.
 *
 * Shell operators are rejected rather than passed through, because kubectl would receive
 * them as literal arguments and fail with a confusing message. That is a usability
 * decision; the safety comes from not using a shell at all.
 */
export function parseKubectlCommandArgs(command: string): Errorable<string[]> {
    const args: string[] = [];
    let current = "";
    let quote: '"' | "'" | undefined;
    let started = false;

    const chars = [...command.trim()];
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (quote !== undefined) {
            if (char === quote) {
                quote = undefined;
            } else if (quote === '"' && char === "\\" && (chars[i + 1] === '"' || chars[i + 1] === "\\")) {
                // As in a shell, \" and \\ are escapes inside double quotes.
                current += chars[++i];
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            started = true;
            continue;
        }

        if (/\s/.test(char)) {
            if (started) {
                args.push(current);
                current = "";
                started = false;
            }
            continue;
        }

        if (SHELL_OPERATORS.includes(char)) {
            return {
                succeeded: false,
                error: `"${char}" is not supported here. This runs kubectl directly, so shell features such as pipes and redirection are unavailable.`,
            };
        }

        current += char;
        started = true;
    }

    if (quote !== undefined) {
        return { succeeded: false, error: `Unterminated ${quote === '"' ? "double" : "single"} quote in the command.` };
    }

    if (started) {
        args.push(current);
    }

    return { succeeded: true, result: args };
}

const SHELL_OPERATORS = ["|", "&", ";", "<", ">", "`"];
