import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { Errorable, failed, getErrorMessage, map } from "./errorable";
import { OutputStream } from "./commands";
import { Observable, concat, of } from "rxjs";
import { NonZeroExitCodeBehaviour } from "./shell";
import { ChildProcess } from "child_process";

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
    podCommand: string,
): Promise<Errorable<KubectlV1.ShellResult>> {
    // kubeconfig goes first here: it belongs to kubectl, not to the command run in the pod.
    // podCommand is still split on whitespace because callers pass a command line for the
    // container, not an argument array; it is extension-controlled in every current caller.
    const args = ["--kubeconfig", kubeConfigFile, "exec", "-n", namespace, pod, "--", ...podCommand.split(" ")];
    return invokeKubectlCommandArgs(kubectl, kubeConfigFile, args, NonZeroExitCodeBehaviour.Fail);
}

/**
 * Runs kubectl with an argument array and no shell, so values carried in `args` cannot be
 * interpreted as commands. This is the only way the extension runs kubectl: there is no
 * string-based entry point, so no caller can reintroduce a shell.
 */
export async function invokeKubectlCommandArgs(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    args: string[],
    exitCodeBehaviour?: NonZeroExitCodeBehaviour,
): Promise<Errorable<KubectlV1.ShellResult>> {
    const behaviour = exitCodeBehaviour ?? NonZeroExitCodeBehaviour.Fail;
    const internal = asInternal(kubectl.api);

    // kubeconfig goes last: kubectl plugins do not accept it before the plugin name.
    const fullArgs = [...args, "--kubeconfig", kubeConfigFile];
    const description = `kubectl ${args.join(" ")}`;

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

        const result = await readChildProcess(child);
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

function readChildProcess(child: ChildProcess): Promise<KubectlV1.ShellResult> {
    return new Promise<KubectlV1.ShellResult>((resolve, reject) => {
        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
        child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
        child.on("error", reject);
        // `code` is null when the process was killed by a signal; report that as a failure
        // rather than as a success, which a 0 default would imply.
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
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

    for (const char of command.trim()) {
        if (quote !== undefined) {
            if (char === quote) {
                quote = undefined;
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
