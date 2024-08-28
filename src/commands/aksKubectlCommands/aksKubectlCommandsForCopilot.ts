import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
// import { DefinedManagedCluster, getKubeconfigYaml } from "../utils/clusters";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
// import * as tmpfile from "../utils/tempfile";
import { KubectlDataProvider, KubectlPanel } from "../../panels/KubectlPanel";
import { getKubectlCustomCommands } from "../utils/config";
import { CurrentClusterContext } from "../utils/clusters";
import { getAssetContext } from "../../assets";
import { createTempFile } from "../utils/tempfile";

function extractText(input: string): string[] {
    const regex = /`{3}([\s\S]*)`{3}/g;
    const matches = [];
    let match;
    while ((match = regex.exec(input)) !== null) {
        matches.push(match[1]);
    }

    return matches.map(txt => {
        return txt.replace("bash", "")
        .replace("shell", "")
        .replace(/\\n/g, "")
    });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
export async function aksRunKubectlCommandsForCopilot(_context: IActionContext, target: any) {

    const generatedCommandsFromChat =  extractText(target["response"]);

    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }
    
    const extension = getExtension();
    const asset = getAssetContext();
    const currentCluster = await asset.globalState.get("currentCluster") as string;

    if(!currentCluster) {
        vscode.window.showErrorMessage("AKS cluster is not set. Please set the AKS cluster first.");
        return
    }

    const parsedCurrentCluster = JSON.parse(currentCluster) as CurrentClusterContext;

    if(!parsedCurrentCluster.kubeConfig) {
        vscode.window.showErrorMessage("Kubeconfig is not set. Please set the AKS cluster first.");
        return;
    }
    
    const kubeConfigFile = await createTempFile(parsedCurrentCluster.kubeConfig, "yaml");

    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const customCommands = getKubectlCustomCommands();
    const dataProvider = new KubectlDataProvider(
        kubectl,
        kubeConfigFile.filePath,
        parsedCurrentCluster.clusterName,
        customCommands,
        generatedCommandsFromChat[0]
    );
    const panel = new KubectlPanel(extension.result.extensionUri);

    panel.show(dataProvider, kubeConfigFile);
}
