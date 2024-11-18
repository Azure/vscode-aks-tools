import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../../commands/utils/errorable";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { longRunning } from "../../commands/utils/host";

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

export function convertAgeToMinutes(creationTimestamp: string): number {
    const createdTime = new Date(creationTimestamp).getTime();
    const currentTime = Date.now();
    const differenceInMinutes = Math.floor((currentTime - createdTime) / (1000 * 60));
    return differenceInMinutes;
}

async function isPodReady(pod: string, kubectl: k8s.APIAvailable<k8s.KubectlV1>, kubeConfigFilePath: string) {
    const command = `get pod ${pod} -n kube-system -o jsonpath='{.status.containerStatuses[*].ready}'`;
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
