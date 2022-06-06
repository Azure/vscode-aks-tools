import { APIAvailable, KubectlV1 } from 'vscode-kubernetes-tools-api';
import { Errorable } from './errorable';

export async function invokeKubectlCommand(kubectl: APIAvailable<KubectlV1>, kubeConfigFile: string, command: string) : Promise<Errorable<KubectlV1.ShellResult>> {
    const shellResult = await kubectl.api.invokeCommand(`--kubeconfig="${kubeConfigFile}" ${command}`);
    if (shellResult === undefined) {
        return { succeeded: false, error: `Failed to run kubectl command: ${command}` };
    }

    if (shellResult.code !== 0) {
        return { succeeded: false, error: `Kubectl returned error ${shellResult.code} for ${command}\nError: ${shellResult.stderr}` };
    }

    return { succeeded: true, result: shellResult };
}
