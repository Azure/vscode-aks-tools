import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { Errorable, failed, getErrorMessage, map } from "./errorable";
import { OutputStream } from "./commands";
import { Observable, concat, of } from "rxjs";

export enum NonZeroExitCodeBehaviour {
    Succeed,
    Fail,
}

type KubeconfigCommandConfig = {
    plainCommand: string;
    commandWithKubeconfig: string;
    exitCodeBehaviour: NonZeroExitCodeBehaviour;
};

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
    return getKubectlJsonResult(kubectl, kubeConfigFile, "version -o json");
}

export async function getExecOutput(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    namespace: string,
    pod: string,
    podCommand: string,
): Promise<Errorable<KubectlV1.ShellResult>> {
    const plainCommand = `exec -n ${namespace} ${pod} -- ${podCommand}`;
    const config: KubeconfigCommandConfig = {
        plainCommand,
        // Note: kubeconfig is the first argument because it needs to be part of the kubectl args, not the exec command's args.
        commandWithKubeconfig: `--kubeconfig="${kubeConfigFile}" ${plainCommand}`,
        // Always fail for non-zero exit code.
        exitCodeBehaviour: NonZeroExitCodeBehaviour.Fail,
    };

    return invokeKubectlCommandInternal(kubectl, config);
}

export function invokeKubectlCommand(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    command: string,
    exitCodeBehaviour?: NonZeroExitCodeBehaviour,
): Promise<Errorable<KubectlV1.ShellResult>> {
    const config: KubeconfigCommandConfig = {
        plainCommand: command,
        // Note: kubeconfig is the last argument because kubectl plugins will not work with kubeconfig in start.
        commandWithKubeconfig: `${command} --kubeconfig="${kubeConfigFile}"`,
        exitCodeBehaviour:
            exitCodeBehaviour === undefined ? NonZeroExitCodeBehaviour.Fail : NonZeroExitCodeBehaviour.Succeed,
    };

    return invokeKubectlCommandInternal(kubectl, config);
}

async function invokeKubectlCommandInternal(
    kubectl: APIAvailable<KubectlV1>,
    config: KubeconfigCommandConfig,
): Promise<Errorable<KubectlV1.ShellResult>> {
    try {
        const shellResult = await kubectl.api.invokeCommand(config.commandWithKubeconfig);
        if (shellResult === undefined) {
            return { succeeded: false, error: `Failed to run command "kubectl ${config.plainCommand}"` };
        }

        if (shellResult.code !== 0 && config.exitCodeBehaviour === NonZeroExitCodeBehaviour.Fail) {
            return {
                succeeded: false,
                error: `The command "kubectl ${config.plainCommand}" returned status code ${shellResult.code}\nError: ${shellResult.stderr}`,
            };
        }

        return { succeeded: true, result: shellResult };
    } catch (e) {
        return { succeeded: false, error: `Error running "kubectl ${config.plainCommand}":\n${getErrorMessage(e)}` };
    }
}

export async function getKubectlJsonResult<T>(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    command: string,
): Promise<Errorable<T>> {
    const shellResult = await invokeKubectlCommand(kubectl, kubeConfigFile, command);
    if (failed(shellResult)) {
        return shellResult;
    }

    const output = shellResult.result.stdout.trim();
    try {
        return { succeeded: true, result: JSON.parse(output) as T };
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to parse command output as JSON:\n\tError: ${e}\n\tCommand: ${command}\n\tOutput: ${output}`,
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
    let namespaceFlags: string;
    switch (namespace) {
        case NamespaceType.AllNamespaces:
            namespaceFlags = "-A";
            break;
        case NamespaceType.NotNamespaced:
            namespaceFlags = "";
            break;
        default:
            namespaceFlags = `-n ${namespace}`;
            break;
    }

    const labelFlags = Object.keys(labels).map((l) => `-l ${l}=${labels[l]}`);

    const command = [`get ${resourceName}`, namespaceFlags, labelFlags, "-o json"].filter((arg) => arg).join(" ");

    const listResult = await getKubectlJsonResult<K8sList<T>>(kubectl, kubeConfigFile, command);
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
