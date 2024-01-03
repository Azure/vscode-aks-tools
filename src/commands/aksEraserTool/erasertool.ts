import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeNode, getClusterProperties, getKubeconfigYaml } from "../utils/clusters";
import { Errorable, failed, succeeded } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { invokeKubectlCommand } from "../utils/kubectl";
import * as tmpfile from "../utils/tempfile";


export default async function aksEraserTool(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        return;
    }

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const properties = await longRunning(`Getting properties for cluster ${clusterNode.result.name}.`, () =>
        getClusterProperties(clusterNode.result),
    );
    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return undefined;
    }

    const kubeconfig = await longRunning(`Retrieving kubeconfig for cluster ${clusterNode.result.name}.`, () =>
        getKubeconfigYaml(clusterNode.result, properties.result),
    );
    if (failed(kubeconfig)) {
        vscode.window.showErrorMessage(kubeconfig.error);
        return undefined;
    }
    
    const clusterName = clusterNode.result.name;

    const answer = await vscode.window.showInformationMessage(
        `Do you want to deploy Eraser tool for cluster ${clusterName} to handle [Automatic Cleaning Image](https://eraser-dev.github.io/eraser/docs/quick-start#automatically-cleaning-images)?`,
        "Yes",
        "No",
    );

    if (answer === "Yes") {
        const result = await longRunning(`Deploying Eraser on cluster ${clusterName}.`, async () => {
            return await deployEraserAutomaticInstallationScenario(kubectl, kubeconfig.result);
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