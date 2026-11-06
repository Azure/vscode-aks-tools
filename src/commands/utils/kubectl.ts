import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { Errorable, failed, getErrorMessage, map } from "./errorable";
import { OutputStream } from "./commands";
import { Observable, concat, of } from "rxjs";
import { NonZeroExitCodeBehaviour } from "./shell";
import * as vscode from "vscode";
import { l10n } from "vscode";
import { getKubectlSettings, resolveKubectlInvocation } from "./kubectlExecutable";
import { kubectlProcessRunner } from "./kubectlProcess";

export { kubectlEnv, MAX_KUBECTL_OUTPUT_BYTES } from "./kubectlProcess";

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

export interface KubectlCommandOptions {
    readonly stdin?: string;
    readonly sensitiveArgs?: readonly number[];
    readonly sensitiveStdin?: boolean;
}

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
    return invokeKubectlCommandArgs(kubectl, kubeConfigFile, ["exec", "-n", namespace, pod, "--", ...podArgs]);
}

/**
 * Runs kubectl with an argument array and no shell, so values carried in `args` cannot be
 * interpreted as commands. Use this for every kubectl call; see development.md for the
 * few exceptions.
 */
export async function invokeKubectlCommandArgs(
    _kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    args: string[],
    exitCodeBehaviour?: NonZeroExitCodeBehaviour,
    options: KubectlCommandOptions = {},
): Promise<Errorable<KubectlV1.ShellResult>> {
    const commandArgs = [...args];
    const shown = redactedKubectlArgs(commandArgs, options.sensitiveArgs);
    const description = `kubectl ${shown.join(" ")}`;
    const sensitive = options.sensitiveStdin || shown.some((arg, index) => arg !== commandArgs[index]);
    const hidden = "Command details hidden because the input contains sensitive data.";

    try {
        const invocation = await resolveKubectlInvocation(
            kubeConfigFile,
            commandArgs,
            getKubectlSettings(),
            createAuthPromptMonitor,
        );
        const result = await kubectlProcessRunner.execute(invocation, options.stdin, createAuthPromptMonitor());
        if (result.code !== 0 && exitCodeBehaviour !== NonZeroExitCodeBehaviour.Succeed) {
            return {
                succeeded: false,
                error: `The command "${description}" returned status code ${result.code}\nError: ${sensitive ? hidden : result.stderr}`,
            };
        }

        return { succeeded: true, result };
    } catch (e) {
        return {
            succeeded: false,
            error: `Error running "${description}":\n${sensitive ? hidden : getErrorMessage(e)}`,
        };
    }
}

/** Display only, never a command to execute. */
export function describeKubectlCommand(args: readonly string[], sensitiveArgs: readonly number[] = []): string {
    return `kubectl ${redactedKubectlArgs(args, sensitiveArgs).join(" ")}`;
}

function redactedKubectlArgs(args: readonly string[], sensitiveArgs: readonly number[] = []): string[] {
    const shown = args.map((arg) =>
        arg
            .replace(/^(--from-literal=)([^=]*=)?.*$/s, "$1$2***")
            .replace(/^(--(?:data|data-raw|data-binary)=).*$/s, "$1***")
            .replace(/^(-d).+$/s, "$1***"),
    );
    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--from-literal" && index + 1 < args.length) {
            shown[index + 1] = args[index + 1].replace(/^([^=]*=)?.*$/s, "$1***");
        }
        if (["-d", "--data", "--data-raw", "--data-binary"].includes(args[index]) && index + 1 < args.length) {
            shown[index + 1] = "***";
        }
    }
    for (const index of sensitiveArgs) {
        if (index >= 0 && index < args.length) {
            shown[index] = "***";
        }
    }
    return shown;
}

export function disposeKubectlProcesses(): void {
    kubectlProcessRunner.dispose();
    authOutputChannel?.dispose();
    authOutputChannel = undefined;
}

// Azure AD device login URLs, as matched by vscode-kubernetes-tools.
const AUTH_PROMPT_PATTERN =
    /https:\/\/(?:[a-z0-9-]+\.)?microsoft(?:online)?\.com\/(?:device|devicelogin|common\/oauth2\/deviceauth)/i;

let authNotificationShown = false;
let authOutputChannel: vscode.OutputChannel | undefined;

/**
 * Shows device login prompts from stderr while kubectl is still running. As in
 * vscode-kubernetes-tools, the line goes to an output channel rather than into the
 * notification, since stderr can also carry text from the API server.
 */
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
                    authOutputChannel ??= vscode.window.createOutputChannel("AKS: kubectl authentication");
                    authOutputChannel.appendLine(line);
                    authOutputChannel.show(true);
                    vscode.window.showWarningMessage(
                        l10n.t("Authentication required. See the output panel for instructions."),
                    );
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
            } else if (quote === '"' && char === "\\" && chars[i + 1] === '"') {
                // Preserve Windows path separators, including the UNC prefix.
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
