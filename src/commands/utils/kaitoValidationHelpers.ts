import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { invokeKubectlCommand } from "../utils/kubectl";

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
    clusterName: string,
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
    if (!kaitoWorkspaceReady) {
        vscode.window.showWarningMessage(
            `The 'kaito-workspace' pod in cluster ${clusterName} is not running. Please review the pod logs in your cluster to diagnose the issue.`,
        );
    } else if (!kaitoGPUProvisionerReady) {
        vscode.window.showWarningMessage(
            `The 'kaito-gpu-provisoner' pod in cluster ${clusterName} is not running. Please review the pod logs in your cluster to diagnose the issue.`,
        );
    }
    console.log({ kaitoWorkspaceReady, kaitoGPUProvisionerReady });
    return { kaitoWorkspaceReady, kaitoGPUProvisionerReady };
}
