import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed, Errorable } from "../../commands/utils/errorable";
import { invokeKubectlCommandArgs } from "../../commands/utils/kubectl";
import { NonZeroExitCodeBehaviour } from "../../commands/utils/shell";
import { longRunning } from "../../commands/utils/host";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { filterPodImage, getKubernetesClusterInfo, getAksClusterTreeNode } from "../../commands/utils/clusters";
import { join } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { isIP } from "net";
import { KubectlV1 } from "vscode-kubernetes-tools-api";
import { Succeeded } from "../../commands/utils/errorable";
import * as tmpfile from "../../commands/utils/tempfile";

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
    const args = ["get", "pod", podName, "-n", nameSpace, "-o", "jsonpath={.status.containerStatuses[*].ready}"];
    const kubectlresult = await invokeKubectlCommandArgs(kubectl, kubeConfigFilePath, args);
    if (failed(kubectlresult)) {
        vscode.window.showErrorMessage(kubectlresult.error);
        return false;
    } else {
        const result = kubectlresult.result.stdout;
        return result.toLowerCase() === "true";
    }
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

/** `kubectl run` arguments for a curl pod that sends the query. Use with `invokeKubectlCommandArgs`. */
export function createCurlPodArgs(
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
): string[] {
    modelName = modelName.startsWith("workspace-") ? modelName.replace("workspace-", "") : modelName;
    if (modelName.startsWith("phi-3-5")) {
        modelName = modelName.replace("phi-3-5", "phi-3.5");
    } else if (modelName.startsWith("qwen-2-5")) {
        modelName = modelName.replace("qwen-2-5", "qwen2.5");
    }

    const endpoint = runtime === "transformers" ? "chat" : "v1/completions";
    const host = isIP(clusterIP) === 6 ? `[${clusterIP}]` : clusterIP;
    const body = JSON.stringify({
        model: modelName,
        prompt,
        temperature,
        top_p: topP,
        top_k: topK,
        repetition_penalty: repetitionPenalty,
        max_tokens: maxLength,
    });

    return [
        "run",
        "-it",
        "--restart=Never",
        podName,
        "--image=curlimages/curl",
        "--",
        "curl",
        "-X",
        "POST",
        `http://${host}/${endpoint}`,
        "-H",
        "accept: application/json",
        "-H",
        "Content-Type: application/json",
        "-d",
        body,
    ];
}

// returns the cluster IP for the model, or "" if it cannot be read
export async function getClusterIP(
    kubeConfigFilePath: string,
    modelName: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    namespace: string,
) {
    const args = ["get", "svc", "-n", namespace, modelName, "-o", "jsonpath={.spec.clusterIP}"];
    const ipResult = await invokeKubectlCommandArgs(kubectl, kubeConfigFilePath, args);
    if (failed(ipResult)) {
        vscode.window.showErrorMessage(`Failed to get cluster IP for model ${modelName}: ${ipResult.error}`);
        return "";
    }

    // Cluster-supplied value used in the curl URL; accept only an IP.
    const clusterIP = ipResult.result.stdout.trim();
    if (isIP(clusterIP) === 0) {
        vscode.window.showErrorMessage(`Service ${modelName} returned an invalid cluster IP: ${clusterIP}`);
        return "";
    }

    return clusterIP;
}

/** Parses a port number (1-65535) from kubectl output, or returns undefined. */
export function parsePort(value: string): number | undefined {
    const trimmed = value.trim();
    if (!/^\d{1,5}$/.test(trimmed)) {
        return undefined;
    }
    const port = Number(trimmed);
    return port >= 1 && port <= 65535 ? port : undefined;
}

export async function getWorkspaceRuntime(
    kubeConfigFilePath: string,
    modelName: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    namespace: string,
): Promise<string> {
    const args = ["get", "workspace", "-n", namespace, modelName, "-o", "json"];
    // Succeed so the exit code and stderr reach the error below.
    const result = await invokeKubectlCommandArgs(kubectl, kubeConfigFilePath, args, NonZeroExitCodeBehaviour.Succeed);
    if (failed(result)) {
        vscode.window.showErrorMessage(`Failed to get runtime for model ${modelName}: ${result.error}`);
        return "vllm";
    }

    const kubectlresult = result.result;
    if (kubectlresult.code === 0) {
        const json = JSON.parse(kubectlresult.stdout);
        const runtime = json.metadata?.annotations?.["kaito.sh/runtime"];
        if (runtime === "transformers") {
            return "transformers";
        } else {
            return "vllm";
        }
    } else {
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
    const kubectlresult = await invokeKubectlCommandArgs(kubectl, kubeConfigFilePath, ["apply", "-f", tempFilePath]);
    unlinkSync(tempFilePath);
    if (failed(kubectlresult)) {
        return { succeeded: false, error: kubectlresult.error };
    } else {
        return { succeeded: true, result: kubectlresult.result };
    }
}

// Returns true if kaito workspace is ready, false otherwise.
export async function isKaitoWorkspaceReady(
    clusterName: string,
    pods: { nameSpace: string; podName: string; imageName: string }[],
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFilePath: string,
) {
    let kaitoWorkspaceReady = false;
    await longRunning(`Checking if KAITO workspace is running.`, async () => {
        for (const pod of pods) {
            // Checking if pods are running
            if (pod.imageName.startsWith("mcr.microsoft.com/aks/kaito/workspace")) {
                if (
                    !kaitoWorkspaceReady &&
                    (await isPodReady(pod.nameSpace, pod.podName, kubectl, kubeConfigFilePath))
                ) {
                    kaitoWorkspaceReady = true;
                }
            }
        }
    });

    if (!kaitoWorkspaceReady) {
        vscode.window.showWarningMessage(
            `The 'kaito-workspace' pod in cluster ${clusterName} is currently unavailable. Please check the pod logs in your cluster to diagnose the issue.`,
        );
    }
    return kaitoWorkspaceReady;
}

// Returns boolean { kaitoInstalled, kaitoWorkspaceReady }
export async function getKaitoInstallationStatus(
    sessionProvider: Succeeded<ReadyAzureSessionProvider>,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    subscriptionId: string,
    resourceGroupName: string,
    clusterName: string,
    clusterYaml: string,
) {
    const status = { kaitoInstalled: false, kaitoWorkspaceReady: false };
    const filterKaitoPodNames = await longRunning(`Checking if KAITO is installed.`, () => {
        return filterPodImage(
            sessionProvider.result,
            kubectl,
            subscriptionId,
            resourceGroupName,
            clusterName,
            "mcr.microsoft.com/aks/kaito",
        );
    });
    if (failed(filterKaitoPodNames)) {
        vscode.window.showErrorMessage(filterKaitoPodNames.error);
        return status;
    }

    if (filterKaitoPodNames.result.length === 0) {
        vscode.window.showWarningMessage(
            `Please install KAITO for cluster ${clusterName}. \n \n Kaito Workspace generation is only enabled when KAITO is installed. Skipping generation.`,
        );
        return status;
    }

    const kubeConfigFile = await tmpfile.createTempFile(clusterYaml, "yaml");
    const kaitoWorkspaceReady = await isKaitoWorkspaceReady(
        clusterName,
        filterKaitoPodNames.result,
        kubectl,
        kubeConfigFile.filePath,
    );
    kubeConfigFile.dispose();
    return { kaitoInstalled: true, kaitoWorkspaceReady };
}

export type ClusterInfo = {
    name: string;
    subscriptionId: string;
    resourceGroupName: string;
    yaml: string;
};

// Type guard to check if an object is of type ClusterInfo
export function isClusterInfo(o: unknown): o is ClusterInfo {
    if (typeof o !== "object" || o === null) {
        return false;
    }
    const obj = o as Record<string, unknown>;
    return (
        typeof obj.name === "string" &&
        typeof obj.subscriptionId === "string" &&
        typeof obj.resourceGroupName === "string" &&
        typeof obj.yaml === "string"
    );
}

// Return cluster details accordingly based on the target type
export async function getClusterDetails(
    target: unknown,
    sessionProvider: ReadyAzureSessionProvider,
    cloudExplorer: k8s.APIAvailable<k8s.CloudExplorerV1>,
    clusterExplorer: k8s.APIAvailable<k8s.ClusterExplorerV1>,
) {
    let kconfigyaml: string;
    let details: {
        name: string;
        subscriptionId: string;
        resourceGroupName: string;
    };

    if (isClusterInfo(target)) {
        kconfigyaml = (target as ClusterInfo).yaml;
        details = target;
    } else {
        const clusterInfo = await getKubernetesClusterInfo(sessionProvider, target, cloudExplorer, clusterExplorer);
        if (failed(clusterInfo)) {
            vscode.window.showErrorMessage(clusterInfo.error);
            return;
        }
        kconfigyaml = clusterInfo.result.kubeconfigYaml;

        const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
        if (failed(clusterNode)) {
            vscode.window.showErrorMessage(clusterNode.error);
            return;
        }
        details = clusterNode.result;
    }
    const kubeConfigFile = await tmpfile.createTempFile(kconfigyaml, "yaml");
    return {
        clusterName: details.name,
        subscriptionId: details.subscriptionId,
        resourceGroupName: details.resourceGroupName,
        kubeConfigFile,
        kconfigyaml,
    };
}
