import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { invokeKubectlCommand } from "../utils/kubectl";
import { filterPodName } from "./clusters";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { Succeeded } from "../utils/errorable";
import * as tmpfile from "../utils/tempfile";
import { KubernetesClusterInfo } from "../utils/clusters";

async function isPodReady(pod: string, kubectl: k8s.APIAvailable<k8s.KubectlV1>, kubeConfigFilePath: string) {
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
    return { kaitoWorkspaceReady, kaitoGPUProvisionerReady };
}

export async function getKaitoInstallationStatus(
    sessionProvider: Succeeded<ReadyAzureSessionProvider>,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    subscriptionId: string,
    resourceGroupName: string,
    clusterName: string,
    clusterInfo: Succeeded<KubernetesClusterInfo>,
) {
    const status = { kaitoInstalled: false, kaitoWorkspaceReady: false, kaitoGPUProvisionerReady: false };
    const filterKaitoPodNames = await longRunning(`Checking if KAITO is installed.`, () => {
        // "kaito-" assumes kaito pods are named kaito-workspace & kaito-gpu-provisioner
        return filterPodName(sessionProvider.result, kubectl, subscriptionId, resourceGroupName, clusterName, "kaito-");
    });

    if (failed(filterKaitoPodNames)) {
        vscode.window.showErrorMessage(filterKaitoPodNames.error);
        return status;
    }

    if (filterKaitoPodNames.result.length === 0) {
        vscode.window.showWarningMessage(
            `Please install Kaito for cluster ${clusterName}. \n \n Kaito Workspace generation is only enabled when kaito is installed. Skipping generation.`,
        );
        return status;
    }

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const { kaitoWorkspaceReady, kaitoGPUProvisionerReady } = await kaitoPodStatus(
        clusterName,
        filterKaitoPodNames.result,
        kubectl,
        kubeConfigFile.filePath,
    );
    return { kaitoInstalled: true, kaitoWorkspaceReady, kaitoGPUProvisionerReady };
}
