import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getExtension, longRunning } from "../utils/host";
import { failed } from "../utils/errorable";
import * as tmpfile from "../utils/tempfile";
import path from "path";
import { ensureDirectoryInPath } from "../utils/env";
import { getRetinaBinaryPath } from "../utils/helper/retinaBinaryDownload";
import { invokeKubectlCommand } from "../utils/kubectl";
// import { withOptionalTempFile } from "../utils/tempfile";
import { RetinaCapturePanel, RetinaCaptureProvider } from "../../panels/RetinaCapturePanel";

export async function aksRetinaCapture(_context: IActionContext, target: unknown): Promise<void> {
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

    const kubectlRetinaPath = await getRetinaBinaryPath();
    if (failed(kubectlRetinaPath)) {
        vscode.window.showWarningMessage(`kubectl retina path was not found ${kubectlRetinaPath.error}`);
        return;
    }

    ensureDirectoryInPath(path.dirname(kubectlRetinaPath.result));

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    console.log(`Kubeconfig file: ${kubeConfigFile}`);

    const retinaCaptureResult = await longRunning(`Retina Disctributed Capture running against cluster ${clusterInfo.result.name}.`, async () => {
        return await invokeKubectlCommand(
            kubectl,
            kubeConfigFile.filePath,
            `retina capture create --host-path /mnt/capture --node-selectors "kubernetes.io/os=linux" --no-wait=false`,
        );
    });

    if (failed(retinaCaptureResult)) {
        vscode.window.showErrorMessage(`Failed to capture the cluster: ${retinaCaptureResult.error}`);
        return;
    }
    console.log(`Retina capture result: ${retinaCaptureResult}`);
    vscode.window.showInformationMessage(`Retina distributed capture ran successfully.`);

    // Get Nodes For this Cluster
    const nodelistResult = await invokeKubectlCommand(
        kubectl,
        kubeConfigFile.filePath, // Fix: Pass the file path instead of the TempFile object
        `get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}'`,
    );

    if (failed(nodelistResult)) {
        vscode.window.showErrorMessage(`Failed to capture the cluster: ${nodelistResult.error}`);
        return;
    }
    const dataProvider = new RetinaCaptureProvider(
        clusterInfo.result.name,
        retinaCaptureResult.result.stdout,
        nodelistResult.result.stdout
    );

    const panel = new RetinaCapturePanel(extension.result.extensionUri);
    panel.show(dataProvider);
    // lets get the log of the capture to local file
    // lets spin the daemonset for running in all nodes.
    // const createDaemonYaml =
    //     `apiVersion: v1
    // kind: Pod
    // metadata:
    //   name: node-explorer
    // spec:
    //   nodeName: aks-agentpool-19415718-vmss000000
    //   volumes:
    //   - name: mnt-captures
    //     hostPath:
    //       path: /mnt/capture
    //   containers:
    //   - name: node-explorer
    //     image: alpine
    //     command: ["sleep", "9999999999"]
    //     volumeMounts:
    //     - name: mnt-captures
    //       mountPath: /mnt/capture
    // `;

    // const applyResult = await withOptionalTempFile(createDaemonYaml, "YAML", async (podSpecFile) => {
    //     const command = `apply -f ${podSpecFile}`;
    //     return await invokeKubectlCommand(kubectl, kubeConfigFile.filePath, command);
    // });

    // if (failed(applyResult)) {
    //     vscode.window.showErrorMessage(`Failed to apply Pod: ${applyResult.error}`);
    //     return;
    // }

    // // kubectl cp 
    // const command = `cp node-explorer:mnt/capture /tmp/capture --request-timeout=10m`;
    // const nodeExplorerResult = await invokeKubectlCommand(kubectl, kubeConfigFile.filePath, command);

    // if (failed(nodeExplorerResult)) {
    //     vscode.window.showErrorMessage(`Failed to apply copy command: ${nodeExplorerResult.error}`);
    //     return;
    // }

    // vscode.window.showInformationMessage(`Yay !! Retina capture is done. Check the logs in /tmp/capture`);

    // const kubectlClusterOperations = new KubectlClusterOperations(kubectl.api, clusterInfo.result, kubeConfigFile);
}
