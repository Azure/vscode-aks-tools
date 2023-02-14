import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo, KubernetesClusterInfo } from '../utils/clusters';
import { getExtensionPath, longRunning } from '../utils/host';
import { Errorable, failed } from '../utils/errorable';
import * as tmpfile from '../utils/tempfile';
import { getKubectlGadgetBinaryPath } from '../utils/helper/kubectlGadgetDownload';
import { invokeKubectlCommand } from '../utils/kubectl';
import path = require('path');
import { createWebView, getRenderedContent, getResourceUri } from '../utils/webviews';

enum Command {
    Deploy,
    Undeploy,
    TopTCP,
    TopEBPF,
    TopBlockIO,
    TopFile,
    ProfileCPU,
    SnapshotProcess,
    SnapshotSocket
}

export async function aksInspektorGadgetDeploy(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.Deploy)
}

export async function aksInspektorGadgetUnDeploy(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.Undeploy);
}

export async function aksInspektorGadgetTopTCP(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.TopTCP);
}

export async function aksInspektorGadgetTopEBPF(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.TopEBPF);
}

export async function aksInspektorGadgetTopBlockIO(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.TopBlockIO);
}

export async function aksInspektorGadgetTopFile(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.TopFile);
}

export async function aksInspektorGadgetProfileCPU(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.ProfileCPU);
}

export async function aksInspektorGadgetSnapshotProcess(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.SnapshotProcess);
}

export async function aksInspektorGadgetSnapshotSocket(
    _context: IActionContext,
    target: any
): Promise<void> {
    await checkTargetAndRunGadgetCommand(target, Command.SnapshotSocket);
}

async function checkTargetAndRunGadgetCommand(
    target: any,
    cmd: Command
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return undefined;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return undefined;
    }

    const clusterInfo = await getKubernetesClusterInfo(target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return undefined;
    }

    await runGadgetCommand(clusterInfo.result, cmd, kubectl);
}

async function runGadgetCommand(
    clusterInfo: KubernetesClusterInfo,
    cmd: Command,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>
): Promise<void> {
    const clustername = clusterInfo.name;
    const kubeconfig = clusterInfo.kubeconfigYaml;

    switch (cmd) {
        case Command.Deploy:
            await deployGadget(clustername, kubeconfig, kubectl);
            return;
        case Command.Undeploy:
            const answer = await vscode.window.showInformationMessage(`Do you want to undeploy Inspektor Gadget in ${clustername}?`, "Yes", "No");
            if (answer === "Yes") {
                await unDeployGadget(clustername, kubeconfig, kubectl);
            }
            return;
        case Command.TopTCP:
            await topTCPGadget(clustername, kubeconfig, kubectl);
            return;
        case Command.TopEBPF:
            await topEBPFGadget(clustername, kubeconfig, kubectl);
            return;
        case Command.TopBlockIO:
            await topBlockIOGadget(clustername, kubeconfig, kubectl);
            return;
        case Command.TopFile:
            await topFile(clustername, kubeconfig, kubectl);
            return;
        case Command.ProfileCPU:
            await profileCPU(clustername, kubeconfig, kubectl);
            return;
        case Command.SnapshotProcess:
            await snapshotProcess(clustername, kubeconfig, kubectl);
            return;
        case Command.SnapshotSocket:
            await snapshotSocket(clustername, kubeconfig, kubectl);
            return;
    }
}

async function deployGadget(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "deploy";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function unDeployGadget(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "undeploy";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function topTCPGadget(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "top tcp 30 --all-namespaces --timeout 30";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function topEBPFGadget(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "top ebpf 30 --all-namespaces --sort cumulruntime --timeout 30";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function topBlockIOGadget(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "top block-io 30 --all-namespaces --timeout 30";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function topFile(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "top file 30 --timeout 30";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}
async function profileCPU(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "profile cpu --timeout 30";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function snapshotProcess(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "snapshot process --all-namespaces 30 --timeout 30";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function snapshotSocket(
    clustername: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "snapshot socket --all-namespaces 30 --timeout 30";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig, kubectl);
}

async function runKubectlGadgetCommands(
    clustername: string,
    command: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {

    const kubectlGadgetPath = await getKubectlGadgetBinaryPath();

    if (failed(kubectlGadgetPath)) {
        vscode.window.showWarningMessage(`kubectl gadget path was not found ${kubectlGadgetPath.error}`);
        return;
    }

    const extensionPath = getExtensionPath();

    if (failed(extensionPath)) {
        vscode.window.showErrorMessage(extensionPath.error);
        return;
    }

    return await longRunning(`Running kubectl gadget command on ${clustername}`,
        async () => {
            const commandToRun = `gadget ${command}`;
            const binaryPathDir = path.dirname(kubectlGadgetPath.result);

            if (process.env.PATH === undefined) {
                process.env.PATH = binaryPathDir
            } else if (process.env.PATH.indexOf(binaryPathDir) < 0) {
                process.env.PATH = binaryPathDir + path.delimiter + process.env.PATH;
            }

            const kubectlresult = await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
                clusterConfig, "YAML", async (kubeConfigFile) => {
                    return await invokeKubectlCommand(kubectl, kubeConfigFile, commandToRun);
                });

            if (failed(kubectlresult)) {
                vscode.window.showWarningMessage(`kubectl gadget command failed with following error: ${kubectlresult.error}`);
                return;
            }

            if (kubectlresult.succeeded) {
                const webview = createWebView('AKS Kubectl Commands', `AKS Kubectl Command view for: ${clustername}`).webview;
                webview.html = getWebviewContent(kubectlresult.result, commandToRun, extensionPath.result, webview);
            }
        }
    );
}

function getWebviewContent(
    clusterdata: k8s.KubectlV1.ShellResult,
    commandRun: string,
    vscodeExtensionPath: string,
    webview: vscode.Webview
): string {
    const styleUri = getResourceUri(webview, vscodeExtensionPath, 'common', 'detector.css');
    const templateUri = getResourceUri(webview, vscodeExtensionPath, 'aksKubectlCommand', 'akskubectlcommand.html');
    const data = {
        cssuri: styleUri,
        name: commandRun,
        command: clusterdata.stdout,
    };

    return getRenderedContent(templateUri, data);
}
