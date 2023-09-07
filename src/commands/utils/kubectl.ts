import { APIAvailable, KubectlV1 } from 'vscode-kubernetes-tools-api';
import { Errorable, failed, getErrorMessage, map } from './errorable';
import { OutputStream } from './commands';
import { Observable, concat, of } from 'rxjs';

export async function invokeKubectlCommand(kubectl: APIAvailable<KubectlV1>, kubeConfigFile: string, command: string): Promise<Errorable<KubectlV1.ShellResult>> {
    // Note: kubeconfig is the last argument because kubectl plugins will not work with kubeconfig in start.
    const shellResult = await kubectl.api.invokeCommand(`${command} --kubeconfig="${kubeConfigFile}"`);
    if (shellResult === undefined) {
        return { succeeded: false, error: `Failed to run kubectl command: ${command}` };
    }

    if (shellResult.code !== 0) {
        return { succeeded: false, error: `Kubectl returned error ${shellResult.code} for ${command}\nError: ${shellResult.stderr}` };
    }

    return { succeeded: true, result: shellResult };
}

export async function getKubectlJsonResult<T>(kubectl: APIAvailable<KubectlV1>, kubeConfigFile: string, command: string): Promise<Errorable<T>> {
    const shellResult = await invokeKubectlCommand(kubectl, kubeConfigFile, command);
    if (failed(shellResult)) {
        return shellResult;
    }

    const output = shellResult.result.stdout.trim();
    try {
        return { succeeded: true, result: JSON.parse(output) as T };
    }
    catch (e) {
        return { succeeded: false, error: `Failed to parse command output as JSON:\n\tError: ${e}\n\tCommand: ${command}\n\tOutput: ${output}` };
    }
}

export enum NamespaceType {
    NotNamespaced,
    AllNamespaces
}

export async function getResources<T>(
    kubectl: APIAvailable<KubectlV1>,
    kubeConfigFile: string,
    resourceName: string,
    namespace: string | NamespaceType,
    labels: { [label: string]: string } = {}
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
            namespaceFlags = `-n ${namespace}`
            break;
    }

    const labelFlags = Object.keys(labels).map(l => `-l ${l}=${labels[l]}`)

    const command = [
        `get ${resourceName}`,
        namespaceFlags,
        labelFlags,
        "-o json"
    ].filter(arg => arg).join(" ");

    const listResult = await getKubectlJsonResult<K8sList<T>>(kubectl, kubeConfigFile, command);
    return map(listResult, r => r.items);
}

interface K8sList<T> {
    items: T[]
}

export async function streamKubectlOutput(kubectl: APIAvailable<KubectlV1>, kubeConfigFile: string, kubectlArgs: string[]): Promise<Errorable<OutputStream>> {
    const kubectlInternal = <KubectlInternal>(<any>kubectl.api).kubectl;

    // If part of the command is a plugin, the kubeconfig argument must be placed after that,
    // so we add it at the end here.
    const args = [...kubectlArgs, "--kubeconfig", kubeConfigFile];
    const runningProcess = await kubectlInternal.observeCommand(args);

    return new Promise<Errorable<OutputStream>>(resolve => {
        // Wait until there's some output or an error before completing
        let running = false;
        runningProcess.lines.subscribe({
            next: line => {
                if (!running) {
                    running = true;
                    const observable = concat(of(line), runningProcess.lines);
                    const disposable = new OutputStream(() => runningProcess.terminate(), observable);
                    resolve({ succeeded: true, result: disposable });
                }
            },
            error: e => resolve({ succeeded: false, error: `Failed to run 'kubectl ${args.join(' ')}': ${getErrorMessage(e)}` }),
            complete: () => resolve({ succeeded: true, result: new OutputStream(() => {}, new Observable()) })
        });
    });
}

interface KubectlInternal {
    observeCommand(args: string[]): Promise<RunningProcess>;
}

interface RunningProcess {
    readonly lines: Observable<string>;
    terminate(): void;
}
