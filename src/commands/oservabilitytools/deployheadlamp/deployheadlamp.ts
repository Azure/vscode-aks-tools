import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as tmpfile from "../../utils/tempfile";
import {
    getAksClusterTreeNode,
    getKubeconfigYaml,
    getManagedCluster,
} from "../../utils/clusters";
import { getExtension, longRunning } from "../../utils/host";
import { AksClusterTreeNode } from "../../../tree/aksClusterTreeItem";
import { Errorable, failed } from "../../utils/errorable";
import { invokeKubectlCommand } from "../../utils/kubectl";
import { getEnvironment, getReadySessionProvider } from "../../../auth/azureAuth";

export default async function deployheadlamp(_context: IActionContext, target: unknown): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    // Once Periscope will support usgov endpoints all we need is to remove this check.
    // I have done background plumbing for vscode to fetch downlodable link from correct endpoint.
    const cloudName = getEnvironment().name;
    if (cloudName !== "AzureCloud") {
        vscode.window.showInformationMessage(`Periscope is not supported in ${cloudName} cloud.`);
        return;
    }

    const properties = await longRunning(`Getting properties for cluster ${clusterNode.result.name}.`, () =>
        getManagedCluster(
            sessionProvider.result,
            clusterNode.result.subscriptionId,
            clusterNode.result.resourceGroupName,
            clusterNode.result.name,
        ),
    );
    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return undefined;
    }

    const kubeconfig = await longRunning(`Retrieving kubeconfig for cluster ${clusterNode.result.name}.`, () =>
        getKubeconfigYaml(
            sessionProvider.result,
            clusterNode.result.subscriptionId,
            clusterNode.result.resourceGroupName,
            properties.result,
        ),
    );
    if (failed(kubeconfig)) {
        vscode.window.showErrorMessage(kubeconfig.error);
        return undefined;
    }

    await longRunning(`Retrieving kubeconfig for cluster ${clusterNode.result.name}.`, () =>
        deployHeadlampInCluster(kubectl, clusterNode.result, kubeconfig.result)
    );
}

async function deployHeadlampInCluster(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterNode: AksClusterTreeNode,
    clusterKubeConfig: string,
): Promise<void> {
    const clusterName = clusterNode.name;
    console.log(`Deploying Headlamp in cluster ${clusterName}.`);

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
        clusterKubeConfig,
        "YAML",
        async (kubeConfigFile) => {
            // Clean up running instance (without an error if it doesn't yet exist).
            // const deleteResult = await invokeKubectlCommand(
            //     kubectl,
            //     kubeConfigFile,
            //     "delete ns aks-periscope --ignore-not-found=true",
            // );
            // if (failed(deleteResult)) return deleteResult;

            // Deploy headlamp.
            const applyResult = await invokeKubectlCommand(kubectl, kubeConfigFile, `apply -k https://raw.githubusercontent.com/kinvolk/headlamp/main/kubernetes-headlamp-ingress-sample.yaml`);
            if (failed(applyResult)) return applyResult;

            // kubectl port-forward -n kube-system service/headlamp 8080:80
            return invokeKubectlCommand(kubectl, kubeConfigFile, " port-forward -n kube-system service/headlamp 8080:80");
        },
    );
    
}

// async function deployKustomizeOverlay(
//     kubectl: k8s.APIAvailable<k8s.KubectlV1>,
//     overlayDir: string,
//     clusterKubeConfig: string,
// ): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
//     return await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
//         clusterKubeConfig,
//         "YAML",
//         async (kubeConfigFile) => {
//             // Clean up running instance (without an error if it doesn't yet exist).
//             const deleteResult = await invokeKubectlCommand(
//                 kubectl,
//                 kubeConfigFile,
//                 "delete ns aks-periscope --ignore-not-found=true",
//             );
//             if (failed(deleteResult)) return deleteResult;

//             // Deploy aks-periscope.
//             const applyResult = await invokeKubectlCommand(kubectl, kubeConfigFile, `apply -k ${overlayDir}`);
//             if (failed(applyResult)) return applyResult;

//             return invokeKubectlCommand(kubectl, kubeConfigFile, "cluster-info");
//         },
//     );
// }
