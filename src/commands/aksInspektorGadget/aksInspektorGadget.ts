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

enum GadgetCommand {
    Deploy,
    Undeploy
}

export async function aksInspektorGadgetDeploy(
    _context: IActionContext,
    target: any
): Promise<void> {
    await gadgetDeployUndeploy(_context, target, GadgetCommand.Deploy)
}

export async function aksInspektorGadgetUnDeploy(
    _context: IActionContext,
    target: any
): Promise<void> {
    await gadgetDeployUndeploy(_context, target, GadgetCommand.Undeploy);
}

async function gadgetDeployUndeploy(
    _context: IActionContext,
    target: any,
    gadget: GadgetCommand
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

    await prepareInspektorGadgetInstall(clusterInfo.result, gadget, kubectl);
}

async function prepareInspektorGadgetInstall(
    clusterInfo: KubernetesClusterInfo,
    gadget: GadgetCommand,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>
): Promise<void> {
    const clustername = clusterInfo.name;
    const kubeconfig = clusterInfo.kubeconfigYaml;

    switch (gadget) {
        case GadgetCommand.Deploy:
            await deployGadget(clustername, kubeconfig, kubectl);
            return;
        case GadgetCommand.Undeploy:
            const answer = await vscode.window.showInformationMessage(`Do you want to undeploy gadget in ${clustername}?`, "Yes", "No");
            if (answer === "Yes") {
                await unDeployGadget(clustername, kubeconfig, kubectl);
            }
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

async function runKubectlGadgetCommands(
    clustername: string,
    command: string,
    clusterConfig: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {

    const kubectlGadgetPath = await getKubectlGadgetBinaryPath();
    let kubetlGadgetBinaryPath = "";

    if (failed(kubectlGadgetPath)) {
        vscode.window.showWarningMessage(`Gadget path is not found ${kubectlGadgetPath.error}`);
        return;
    }

    kubetlGadgetBinaryPath = kubectlGadgetPath.result;

    const extensionPath = getExtensionPath();

    if (failed(extensionPath)) {
      vscode.window.showErrorMessage(extensionPath.error);
      return;
    }

    return await longRunning(`Loading ${clustername} kubectl command run.`,
        async () => {
            const commandToRun = `gadget ${command}`;
            console.log(kubetlGadgetBinaryPath);
            const  binaryPathDir = path.dirname(kubetlGadgetBinaryPath);

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
                vscode.window.showWarningMessage(`Gadget command failed with following error: ${kubectlresult.error}`)
            }

            if (kubectlresult.succeeded) {
                const webview = createWebView('AKS Kubectl Commands', `AKS Kubectl Command view for: ${clustername}`).webview;
                webview.html = getWebviewContent(kubectlresult.result, command, extensionPath.result, webview);
            }

            return true;
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
  