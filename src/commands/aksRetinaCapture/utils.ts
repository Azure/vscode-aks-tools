import * as k8s from "vscode-kubernetes-tools-api";
import * as vscode from "vscode";
import { Errorable } from "../utils/errorable";
import { failed } from "../utils/errorable";
import { getLinuxNodes } from "../../panels/utilities/KubectlNetworkHelper";

export async function selectLinuxNodes(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFilePath: string,
    title: string = "Select Nodes to Capture Traffic From",
    placeHolder: string = "Please select all the Nodes you want Retina to capture traffic from.",
): Promise<Errorable<string>> {
    const linuxNodesList = await getLinuxNodes(kubectl, kubeConfigFilePath);
    if (failed(linuxNodesList)) {
        return linuxNodesList;
    }

    const nodeNamesSelected = await vscode.window.showQuickPick(linuxNodesList.result, {
        canPickMany: true,
        placeHolder,
        title,
    });

    if (!nodeNamesSelected || nodeNamesSelected.length === 0) {
        return { succeeded: false, error: "No nodes were selected." };
    }

    const selectedNodes = nodeNamesSelected.join(",");

    return { succeeded: true, result: selectedNodes };
}
