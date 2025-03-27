import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { invokeKubectlCommand } from "../utils/kubectl";
import { filterPodImage } from "./clusters";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { Succeeded } from "../utils/errorable";
import * as tmpfile from "../utils/tempfile";
import { KubernetesClusterInfo } from "../utils/clusters";

// Returns true if pod is ready, false otherwise
async function isPodReady(
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

// Returns { kaitoWorkspaceReady, kaitoGPUProvisionerReady }, where each value is true if the corresponding pod is ready
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

// Returns boolean { kaitoInstalled, kaitoWorkspaceReady, kaitoGPUProvisionerReady }
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

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const { kaitoWorkspaceReady, kaitoGPUProvisionerReady } = await kaitoPodStatus(
        clusterName,
        filterKaitoPodNames.result,
        kubectl,
        kubeConfigFile.filePath,
    );
    kubeConfigFile.dispose();
    return { kaitoInstalled: true, kaitoWorkspaceReady, kaitoGPUProvisionerReady };
}
