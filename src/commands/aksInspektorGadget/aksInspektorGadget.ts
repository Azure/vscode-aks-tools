import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo, KubernetesClusterInfo } from '../utils/clusters';
import { longRunning } from '../utils/host';
import { failed } from '../utils/errorable';
import { invokeKubectlCommandOnCurrentCluster } from '../utils/kubectl';


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

    await prepareInspektorGadgetInstall(clusterInfo.result, kubectl, gadget);
}

async function prepareInspektorGadgetInstall(
    cloudTarget: KubernetesClusterInfo,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    gadget: InspektorGadget
): Promise<void> {
    const clustername = cloudTarget.name;

    // Is Krew present:
    // If not display warning with instruciton link to download krew page.
    // If yes then do the kubectl krew install gadget and then kubectl gadget deploy and on success show information otherwise warning.
    // For undeploy do same check for krew and then kubectl gadget undeploy.
    const isKrew = await isKrewInstalled(clustername, kubectl);

    if (!isKrew) {
        //https://github.com/microsoft/vscode/issues/158308
        const contents = new vscode.MarkdownString(`Please follow following instructions to [install krew](https://krew.sigs.k8s.io/docs/user-guide/setup/install/) which is prerequisite for Inspektor Gadgte installation.`);
        vscode.window.showInformationMessage(contents.value);
        return;
    }

    switch (gadget) {
        case InspektorGadget.Deploy:
            // Install Gadget and then deploy gadget
            const isGadgetInstalled = await installGadget(clustername, kubectl);
            if (!isGadgetInstalled) {
                return;
            }
            await deployGadget(clustername, kubectl);
            return;
        case InspektorGadget.Undeploy:
            const answer = await vscode.window.showInformationMessage(`Do you want to undeploy gadget in selected cluster?`, "Yes", "No");
            if (answer === "Yes") {
                await unDeployGadget(clustername, kubectl);
            }
            return;
    }
}

async function isKrewInstalled(
    clustername: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "krew version";

    return await runKubectlCommands(clustername, command, kubectl);
}

async function installGadget(clustername: string, kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "krew install gadget";

    return await runKubectlCommands(clustername, command, kubectl);
}

async function deployGadget(clustername: string, kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "gadget deploy";

    return await runKubectlCommands(clustername, command, kubectl);
}

async function unDeployGadget(clustername: string, kubectl: k8s.APIAvailable<k8s.KubectlV1>) {
    const command = "gadget undeploy";

    return await runKubectlCommands(clustername, command, kubectl);
}

async function runKubectlCommands(
    clustername: string,
    comand: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>) {

    return await longRunning(`Loading ${clustername} kubectl command run.`,
        async () => {
            const kubectlresult = await invokeKubectlCommandOnCurrentCluster(kubectl, comand);

            if (failed(kubectlresult)) {
                vscode.window.showErrorMessage(kubectlresult.error);
                return false;
            }

            return true;
        }
    );
}