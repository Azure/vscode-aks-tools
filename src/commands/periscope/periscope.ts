import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as tmpfile from "../utils/tempfile";
import { getAksClusterTreeItem, getClusterProperties, getContainerClient, getKubeconfigYaml } from "../utils/clusters";
import { getKustomizeConfig } from "../utils/config";
import { getExtension, longRunning } from "../utils/host";
import {
    getClusterDiagnosticSettings,
    chooseStorageAccount,
    getStorageInfo,
    prepareAKSPeriscopeKustomizeOverlay,
    getNodeNames,
    getClusterFeatures,
} from "./helpers/periscopehelper";
import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import { Errorable, failed } from "../utils/errorable";
import { invokeKubectlCommand } from "../utils/kubectl";
import { PeriscopeDataProvider, PeriscopePanel } from "../../panels/PeriscopePanel";

export default async function periscope(_context: IActionContext, target: unknown): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        return;
    }

    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    // Once Periscope will support usgov endpoints all we need is to remove this check.
    // I have done background plumbing for vscode to fetch downlodable link from correct endpoint.
    const cloudName = cluster.result.subscription.environment.name;
    if (cloudName !== "AzureCloud") {
        vscode.window.showInformationMessage(`Periscope is not supported in ${cloudName} cloud.`);
        return;
    }

    const properties = await longRunning(`Getting properties for cluster ${cluster.result.name}.`, () =>
        getClusterProperties(cluster.result),
    );
    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return undefined;
    }

    const kubeconfig = await longRunning(`Retrieving kubeconfig for cluster ${cluster.result.name}.`, () =>
        getKubeconfigYaml(cluster.result, properties.result),
    );
    if (failed(kubeconfig)) {
        vscode.window.showErrorMessage(kubeconfig.error);
        return undefined;
    }

    await runAKSPeriscope(kubectl, cluster.result, kubeconfig.result);
}

async function runAKSPeriscope(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    cluster: AksClusterTreeItem,
    clusterKubeConfig: string,
): Promise<void> {
    const clusterName = cluster.name;

    // Get Diagnostic settings for cluster and get associated storage account information.
    const clusterDiagnosticSettings = await longRunning(`Identifying cluster diagnostic settings.`, () =>
        getClusterDiagnosticSettings(cluster),
    );

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const panel = new PeriscopePanel(extension.result.extensionUri);

    if (!clusterDiagnosticSettings || !clusterDiagnosticSettings.value?.length) {
        // If there is no storage account attached to diagnostic setting, don't move forward and at this point we will render webview with helpful content.
        const dataProvider = PeriscopeDataProvider.createForNoDiagnostics(cluster.name);
        panel.show(dataProvider);
        return;
    }

    // TODO: It's possible to have diagnostics configured, but with no storage account. If that's the case,
    // we'll fail silently at this point. Need to improve the UX here.
    const clusterStorageAccountId = await chooseStorageAccount(clusterDiagnosticSettings);
    if (!clusterStorageAccountId) return;

    // Generate storage sas keys, manage aks persicope run.
    const clusterStorageInfo = await longRunning(`Generating SAS for ${clusterName} cluster.`, () =>
        getStorageInfo(kubectl, cluster, clusterStorageAccountId, clusterKubeConfig),
    );

    if (failed(clusterStorageInfo)) {
        vscode.window.showErrorMessage(clusterStorageInfo.error);
        return;
    }

    const kustomizeConfig = getKustomizeConfig();
    if (failed(kustomizeConfig)) {
        vscode.window.showErrorMessage(kustomizeConfig.error);
        return;
    }

    const containerClient = getContainerClient(cluster);

    // Get the features of the cluster that determine which optional kustomize components to deploy.
    const clusterFeatures = await getClusterFeatures(containerClient, cluster.resourceGroupName, cluster.name);
    if (failed(clusterFeatures)) {
        vscode.window.showErrorMessage(clusterFeatures.error);
        return;
    }

    // Create a run ID of format: YYYY-MM-DDThh-mm-ssZ
    const runId = `${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}Z`;

    const aksDeploymentFile = await longRunning(
        `Creating AKS Periscope resource specification for ${clusterName}.`,
        () =>
            prepareAKSPeriscopeKustomizeOverlay(
                clusterStorageInfo.result,
                kustomizeConfig.result,
                clusterFeatures.result,
                runId,
            ),
    );

    if (failed(aksDeploymentFile)) {
        vscode.window.showErrorMessage(aksDeploymentFile.error);
        return;
    }

    const nodeNames = await getNodeNames(kubectl, clusterKubeConfig);
    if (failed(nodeNames)) {
        vscode.window.showErrorMessage(nodeNames.error);
        return;
    }

    const runCommandResult = await longRunning(`Deploying AKS Periscope to ${clusterName}.`, () =>
        deployKustomizeOverlay(kubectl, aksDeploymentFile.result, clusterKubeConfig),
    );

    const deploymentParameters = {
        kubectl,
        kustomizeConfig: kustomizeConfig.result,
        storage: clusterStorageInfo.result,
        clusterKubeConfig,
        periscopeNamespace: "aks-periscope",
    };

    if (failed(runCommandResult)) {
        // For a failure running the command result, we display the error in a webview.
        const dataProvider = PeriscopeDataProvider.createForDeploymentError(
            cluster.name,
            runId,
            runCommandResult.error,
            deploymentParameters,
        );
        panel.show(dataProvider);
        return;
    }

    // Show the webview for successful deployment
    const dataProvider = PeriscopeDataProvider.createForDeploymentSuccess(
        cluster.name,
        runId,
        nodeNames.result,
        deploymentParameters,
    );
    panel.show(dataProvider);
}

async function deployKustomizeOverlay(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    overlayDir: string,
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
                "delete ns aks-periscope --ignore-not-found=true",
            );
            if (failed(deleteResult)) return deleteResult;

            // Deploy aks-periscope.
            const applyResult = await invokeKubectlCommand(kubectl, kubeConfigFile, `apply -k ${overlayDir}`);
            if (failed(applyResult)) return applyResult;

            return invokeKubectlCommand(kubectl, kubeConfigFile, "cluster-info");
        },
    );
}
