import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo, KubernetesClusterInfo } from '../utils/clusters';
import { longRunning } from '../utils/host';
import { Errorable, failed } from '../utils/errorable';
import { shell } from '../utils/shell';
import * as tmpfile from '../utils/tempfile';
import { getKubectlGadgetBinaryPath } from '../utils/helper/kubectlGadgetDownload';

enum InspektorGadget {
    Deploy,
    Undeploy
}

export async function aksInspektorGadgetDeploy(
    _context: IActionContext,
    target: any
): Promise<void> {
    await gadgetDeployUndeploy(_context, target, InspektorGadget.Deploy)
}

export async function aksInspektorGadgetUnDeploy(
    _context: IActionContext,
    target: any
): Promise<void> {
    await gadgetDeployUndeploy(_context, target, InspektorGadget.Undeploy);
}

async function gadgetDeployUndeploy(
    _context: IActionContext,
    target: any,
    gadget: InspektorGadget
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

    await prepareInspektorGadgetInstall(clusterInfo.result, gadget, clusterInfo.result.kubeconfigYaml);
}

async function prepareInspektorGadgetInstall(
    cloudTarget: KubernetesClusterInfo,
    gadget: InspektorGadget,
    kubeconfig: string
): Promise<void> {
    const clustername = cloudTarget.name;

    switch (gadget) {
        case InspektorGadget.Deploy:
            await deployGadget(clustername, kubeconfig);
            return;
        case InspektorGadget.Undeploy:
            const answer = await vscode.window.showInformationMessage(`Do you want to undeploy gadget in selected cluster?`, "Yes", "No");
            if (answer === "Yes") {
                await unDeployGadget(clustername, kubeconfig);
            }
            return;
    }
}

async function deployGadget(
    clustername: string, 
    clusterConfig: string) {
    const command = "deploy";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig);
}

async function unDeployGadget(
    clustername: string, 
    clusterConfig: string) {
    const command = "undeploy";

    return await runKubectlGadgetCommands(clustername, command, clusterConfig);
}

async function runKubectlGadgetCommands(
    clustername: string,
    command: string,
    clusterConfig: string) {

    const kubectlGadgetPath = await getKubectlGadgetBinaryPath();
    let kubetlGadgetBinaryPath = "";

    if (failed(kubectlGadgetPath)) {
        vscode.window.showWarningMessage(`Gadget path is not found ${kubectlGadgetPath.error}`);
    }

    if (kubectlGadgetPath.succeeded) {
        kubetlGadgetBinaryPath = kubectlGadgetPath.result;
    }

    return await longRunning(`Loading ${clustername} kubectl command run.`,
        async () => {
            const commandToRun = `${kubetlGadgetBinaryPath} ${command}`;

            const runCommandResult = await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
                clusterConfig,
                "YAML",
                (kubeConfigFile) => shell.exec(`${commandToRun} --kubeconfig=${kubeConfigFile}` ));

            if (failed(runCommandResult)) {
                vscode.window.showWarningMessage(`Gadget command failed with following error: ${runCommandResult.error}`)
            }

            if (runCommandResult.succeeded) {
                console.log(runCommandResult.result.stdout);
                vscode.window.showInformationMessage(`Gadget successfully ran ${command}.`)
            }

            return true;
        }
    );
}