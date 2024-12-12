import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../../commands/utils/errorable";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { longRunning } from "../../commands/utils/host";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { filterPodName } from "../../commands/utils/clusters";

// helper for parsing the conditions object on a workspace
function statusToBoolean(status: string): boolean {
    if (status.toLowerCase() === "true") {
        return true;
    }
    return false;
}

// This helper function parses & returns resource values for the conditions object on a workspace
export function getConditions(conditions: Array<{ type: string; status: string }>) {
    let resourceReady = null;
    let inferenceReady = null;
    let workspaceReady = null;
    conditions.forEach(({ type, status }) => {
        switch (type.toLowerCase()) {
            case "resourceready":
                resourceReady = statusToBoolean(status);
                break;
            case "workspacesucceeded":
                workspaceReady = statusToBoolean(status);
                break;
            case "inferenceready":
                inferenceReady = statusToBoolean(status);
                break;
        }
    });
    return { resourceReady, inferenceReady, workspaceReady };
}

// This helper function converts the creation timestamp to minutes
export function convertAgeToMinutes(creationTimestamp: string): number {
    const createdTime = new Date(creationTimestamp).getTime();
    const currentTime = Date.now();
    const differenceInMinutes = Math.floor((currentTime - createdTime) / (1000 * 60));
    return differenceInMinutes;
}

export async function isPodReady(pod: string, kubectl: k8s.APIAvailable<k8s.KubectlV1>, kubeConfigFilePath: string) {
    const command = `get pod ${pod} -n kube-system -o jsonpath="{.status.containerStatuses[*].ready}"`;
    const kubectlresult = await invokeKubectlCommand(kubectl, kubeConfigFilePath, command);
    if (failed(kubectlresult)) {
        vscode.window.showErrorMessage(kubectlresult.error);
        return false;
    } else {
        const result = kubectlresult.result.stdout;
        return result.toLowerCase() === "true";
    }
}

export async function kaitoPodStatus(
    pods: string[],
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFilePath: string,
) {
    let { kaitoWorkspaceReady, kaitoGPUProvisionerReady } = {
        kaitoWorkspaceReady: false,
        kaitoGPUProvisionerReady: false,
    };

    await longRunning(`Checking if KAITO pods are running.`, async () => {
        for (const pod of pods) {
            // Checking if pods are running
            if (pod.startsWith("kaito-workspace")) {
                if (!kaitoWorkspaceReady && (await isPodReady(pod, kubectl, kubeConfigFilePath))) {
                    kaitoWorkspaceReady = true;
                }
            } else if (pod.startsWith("kaito-gpu-provisioner")) {
                if (!kaitoGPUProvisionerReady && (await isPodReady(pod, kubectl, kubeConfigFilePath))) {
                    kaitoGPUProvisionerReady = true;
                }
            }
        }
    });
    return { kaitoWorkspaceReady, kaitoGPUProvisionerReady };
}

export async function getKaitoPods(
    sessionProvider: ReadyAzureSessionProvider,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    subscriptionId: string,
    resourceGroupName: string,
    clusterName: string,
) {
    const kaitoPodsPromise = await filterPodName(
        sessionProvider,
        kubectl,
        subscriptionId,
        resourceGroupName,
        clusterName,
        "kaito-",
    );
    if (failed(kaitoPodsPromise)) {
        return [];
    }
    return kaitoPodsPromise.result;
}

export async function createCurlPodCommand(
    kubeConfigFilePath: string,
    podName: string,
    clusterIP: string,
    prompt: string,
    temperature: number,
    topP: number,
    topK: number,
    repetitionPenalty: number,
    maxLength: number,
) {
    // Command for windows platforms (Needs custom character escaping)
    if (process.platform === "win32") {
        const windowsCreateCommand = `--kubeconfig="${kubeConfigFilePath}" run -it --restart=Never ${podName} \
--image=curlimages/curl -- curl -X POST http://${clusterIP}/chat -H "accept: application/json" -H \
"Content-Type: application/json" -d "{\\"prompt\\":\\"${escapeSpecialChars(prompt)}\\", \
\\"generate_kwargs\\":{\\"temperature\\":${temperature}, \\"top_p\\":${topP}, \\"top_k\\":${topK}, \
\\"repetition_penalty\\":${repetitionPenalty}, \\"max_length\\":${maxLength}}}"`;
        return windowsCreateCommand;
    } else {
        // Command for UNIX platforms (Should work for all other process.platform return values besides win32)
        const unixCreateCommand = `--kubeconfig="${kubeConfigFilePath}" run -it --restart=Never ${podName} \
--image=curlimages/curl -- curl -X POST http://${clusterIP}/chat -H "accept: application/json" -H \
"Content-Type: application/json" -d '{"prompt":"${escapeSpecialChars(prompt)}", \
"generate_kwargs":{"temperature":${temperature}, "top_p":${topP}, "top_k":${topK}, \
"repetition_penalty":${repetitionPenalty}, "max_length":${maxLength}}}'`;
        return unixCreateCommand;
    }
}

export function deleteCurlPodCommand(kubeConfigFilePath: string, podName: string) {
    const deleteCommand = `--kubeconfig="${kubeConfigFilePath}" delete pod ${podName}`;
    return deleteCommand;
}

export function getCurlPodLogsCommand(kubeConfigFilePath: string, podName: string) {
    const logsCommand = `--kubeconfig="${kubeConfigFilePath}" logs ${podName}`;
    return logsCommand;
}

// Sanitizing the input string
function escapeSpecialChars(input: string) {
    return input
        .replace(/\\/g, "\\\\") // Escape backslashes
        .replace(/"/g, '\\"') // Escape double quotes
        .replace(/'/g, "") // Remove single quotes
        .replace(/\n/g, "\\n") // Escape newlines
        .replace(/\r/g, "\\r") // Escape carriage returns
        .replace(/\t/g, "\\t") // Escape tabs
        .replace(/\f/g, "\\f") // Escape form feeds
        .replace(/`/g, "") // Remove backticks
        .replace(/\0/g, "\\0"); // Escape null characters
}

export async function getClusterIP(
    kubeConfigFilePath: string,
    modelName: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
) {
    const ipCommand = `--kubeconfig="${kubeConfigFilePath}" get svc workspace-${modelName} -o jsonpath="{.spec.clusterIP}"`;
    const ipResult = await kubectl.api.invokeCommand(ipCommand);
    if (ipResult && ipResult.code === 0) {
        return ipResult.stdout;
    } else if (ipResult === undefined) {
        vscode.window.showErrorMessage(`Failed to get cluster IP for model ${modelName}`);
    } else if (ipResult.code !== 0) {
        vscode.window.showErrorMessage(`Failed to connect to cluster: ${ipResult.code}\nError: ${ipResult.stderr}`);
    }
    return "";
}
