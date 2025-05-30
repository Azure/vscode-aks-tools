import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed, Errorable } from "../../commands/utils/errorable";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { longRunning } from "../../commands/utils/host";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { filterPodImage } from "../../commands/utils/clusters";
import { join } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { KubectlV1 } from "vscode-kubernetes-tools-api";

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

export async function isPodReady(
    nameSpace: string,
    podName: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFilePath: string,
) {
    const command = `get pod ${podName} -n ${nameSpace} -o jsonpath="{.status.containerStatuses[*].ready}"`;
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
    clusterName: string,
    pods: { nameSpace: string; podName: string; imageName: string }[],
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
            if (pod.imageName.startsWith("mcr.microsoft.com/aks/kaito/workspace")) {
                if (
                    !kaitoWorkspaceReady &&
                    (await isPodReady(pod.nameSpace, pod.podName, kubectl, kubeConfigFilePath))
                ) {
                    kaitoWorkspaceReady = true;
                }
            } else if (pod.imageName.startsWith("mcr.microsoft.com/aks/kaito/gpu-provisioner")) {
                if (
                    !kaitoGPUProvisionerReady &&
                    (await isPodReady(pod.nameSpace, pod.podName, kubectl, kubeConfigFilePath))
                ) {
                    kaitoGPUProvisionerReady = true;
                }
            }
        }
    });

    const podStatuses = [
        { ready: kaitoWorkspaceReady, name: "kaito-workspace" },
        { ready: kaitoGPUProvisionerReady, name: "kaito-gpu-provisioner" },
    ];

    podStatuses.forEach((pod) => {
        if (!pod.ready) {
            vscode.window.showWarningMessage(
                `The '${pod.name}' pod in cluster ${clusterName} is currently unavailable. Please check the pod logs in your cluster to diagnose the issue.`,
            );
        }
    });

    return { kaitoWorkspaceReady, kaitoGPUProvisionerReady };
}

// returns an array with the names of all pods starting with "kaito-"
export async function getKaitoPods(
    sessionProvider: ReadyAzureSessionProvider,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    subscriptionId: string,
    resourceGroupName: string,
    clusterName: string,
) {
    const kaitoPods = await filterPodImage(
        sessionProvider,
        kubectl,
        subscriptionId,
        resourceGroupName,
        clusterName,
        "mcr.microsoft.com/aks/kaito",
    );

    if (failed(kaitoPods)) {
        return [];
    }
    return kaitoPods.result;
}

export async function createCurlPodCommand(
    kubeConfigFilePath: string,
    podName: string,
    modelName: string,
    clusterIP: string,
    prompt: string,
    temperature: number,
    topP: number,
    topK: number,
    repetitionPenalty: number,
    maxLength: number,
    runtime: string = "vllm",
) {
    modelName = modelName.startsWith("workspace-") ? modelName.replace("workspace-", "") : modelName;
    if (modelName.startsWith("phi-3-5")) {
        modelName = modelName.replace("phi-3-5", "phi-3.5");
    } else if (modelName.startsWith("qwen-2-5")) {
        modelName = modelName.replace("qwen-2-5", "qwen2.5");
    }
    // Command for windows platforms (Needs custom character escaping)
    if (process.platform === "win32") {
        let windowsCreateCommand;
        if (runtime === "transformers") {
            windowsCreateCommand = `--kubeconfig="${kubeConfigFilePath}" run -it --restart=Never ${podName} \
--image=curlimages/curl -- curl -X POST http://${clusterIP}/chat -H "accept: application/json" -H \
"Content-Type: application/json" -d "{\\"model\\":\\"${modelName}\\", \\"prompt\\":\\"${escapeSpecialChars(prompt)}\\", \
\\"temperature\\":${temperature}, \\"top_p\\":${topP}, \\"top_k\\":${topK}, \
\\"repetition_penalty\\":${repetitionPenalty}, \\"max_tokens\\":${maxLength}}"`;
        } else {
            windowsCreateCommand = `--kubeconfig="${kubeConfigFilePath}" run -it --restart=Never ${podName} \
--image=curlimages/curl -- curl -X POST http://${clusterIP}/v1/completions -H "accept: application/json" -H \
"Content-Type: application/json" -d "{\\"model\\":\\"${modelName}\\", \\"prompt\\":\\"${escapeSpecialChars(prompt)}\\", \
\\"temperature\\":${temperature}, \\"top_p\\":${topP}, \\"top_k\\":${topK}, \
\\"repetition_penalty\\":${repetitionPenalty}, \\"max_tokens\\":${maxLength}}"`;
        }
        return windowsCreateCommand;
    } else {
        // Command for UNIX platforms (Should work for all other process.platform return values besides win32)
        let unixCreateCommand;
        if (runtime === "transformers") {
            unixCreateCommand = `--kubeconfig="${kubeConfigFilePath}" run -it --restart=Never ${podName} \
--image=curlimages/curl -- curl -X POST http://${clusterIP}/chat -H "accept: application/json" -H \
"Content-Type: application/json" -d '{"model":"${modelName}", "prompt":"${escapeSpecialChars(prompt)}", \
"temperature":${temperature}, "top_p":${topP}, "top_k":${topK}, "repetition_penalty":${repetitionPenalty}, \
 "max_tokens":${maxLength}}'`;
        } else {
            unixCreateCommand = `--kubeconfig="${kubeConfigFilePath}" run -it --restart=Never ${podName} \
--image=curlimages/curl -- curl -X POST http://${clusterIP}/v1/completions -H "accept: application/json" -H \
"Content-Type: application/json" -d '{"model":"${modelName}", "prompt":"${escapeSpecialChars(prompt)}", \
"temperature":${temperature}, "top_p":${topP}, "top_k":${topK}, "repetition_penalty":${repetitionPenalty}, \
 "max_tokens":${maxLength}}'`;
        }
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

// returns the cluster IP for the model
export async function getClusterIP(
    kubeConfigFilePath: string,
    modelName: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    namespace: string,
) {
    void namespace;
    const ipCommand = `--kubeconfig="${kubeConfigFilePath}" get svc -n ${namespace} ${modelName} -o jsonpath="{.spec.clusterIP}" `;
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

export async function getWorkspaceRuntime(
    kubeConfigFilePath: string,
    modelName: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    namespace: string,
): Promise<string> {
    const command = `--kubeconfig="${kubeConfigFilePath}" get workspace -n ${namespace} ${modelName} -o json`;
    const kubectlresult = await kubectl.api.invokeCommand(command);
    if (kubectlresult && kubectlresult.code === 0) {
        const json = JSON.parse(kubectlresult.stdout);
        const runtime = json.metadata?.annotations?.["kaito.sh/runtime"];
        if (runtime === "transformers") {
            return "transformers";
        } else {
            return "vllm";
        }
    } else if (kubectlresult === undefined) {
        vscode.window.showErrorMessage(`Failed to get runtime for model ${modelName}`);
    } else if (kubectlresult.code !== 0) {
        vscode.window.showErrorMessage(
            `Failed to connect to cluster: ${kubectlresult.code}\nError: ${kubectlresult.stderr}`,
        );
    }
    return "vllm"; // Default to vllm if runtime is not found
}

// deploys model with given yaml & returns errorable promise
export async function deployModel(
    yaml: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFilePath: string,
): Promise<Errorable<KubectlV1.ShellResult>> {
    const tempFilePath = join(tmpdir(), `kaito-deployment-${Date.now()}.yaml`);
    writeFileSync(tempFilePath, yaml, "utf8");
    const command = `apply -f ${tempFilePath}`;
    const kubectlresult = await invokeKubectlCommand(kubectl, kubeConfigFilePath, command);
    unlinkSync(tempFilePath);
    if (failed(kubectlresult)) {
        return { succeeded: false, error: kubectlresult.error };
    } else {
        return { succeeded: true, result: kubectlresult.result };
    }
}
