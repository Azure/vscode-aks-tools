import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { Errorable, failed, succeeded } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { invokeKubectlCommand } from "../utils/kubectl";
import * as tmpfile from "../utils/tempfile";


export default async function aksEraserTool(_context: IActionContext, target: unknown): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return;
    }

    const clusterInfo = await getKubernetesClusterInfo(target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return;
    }
    
    const clusterName = clusterInfo.result.name;

    const answer = await vscode.window.showInformationMessage(
        `Do you want to deploy Eraser tool for cluster ${clusterName} to handle [Automatic Cleaning Image](https://eraser-dev.github.io/eraser/docs/quick-start#automatically-cleaning-images)?`,
        "Yes",
        "No",
    );

    if (answer === "Yes") {
        const result = await longRunning(`Deploying Eraser on cluster ${clusterName}.`, async () => {
            return await deployEraserAutomaticInstallationScenario(kubectl, clusterInfo.result.kubeconfigYaml);
        });

        if (failed(result)) {
            vscode.window.showErrorMessage(result.error);
        }

        if (succeeded(result)) {
            vscode.window.showInformationMessage(`Eraser tool is successfully deployed into cluster ${clusterName}. \n Output: \n ${result.result.stdout}`);
        }
    }
}

async function deployEraserAutomaticInstallationScenario(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeConfig: string,
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    return await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
        clusterKubeConfig,
        "YAML",
        async (kubeConfigFile) => {
            // Clean up running instance (without an error if it doesn't yet exist).
            const deleteResult = await invokeKubectlCommand(
                kubectl,
                kubeConfigFile,
                "delete ns eraser-system --ignore-not-found=true",
            );
            if (failed(deleteResult)) return deleteResult;

            // Deploy eraser tool: https://eraser-dev.github.io/eraser/docs/installation
            const applyResult = await invokeKubectlCommand(kubectl, kubeConfigFile, `apply -f https://raw.githubusercontent.com/eraser-dev/eraser/v1.2.0/deploy/eraser.yaml`);
            if (failed(applyResult)) return applyResult;

            return applyResult;
        },
    );
}