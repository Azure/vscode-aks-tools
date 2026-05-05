import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getExtension } from "../utils/host";
import { failed, succeeded } from "../utils/errorable";
import { KickstartPanel, KickstartPanelDataProvider } from "../../panels/KickstartPanel";
import { getAksClusterTreeNode } from "../utils/clusters";

export async function aksKickstart(_context: IActionContext, target?: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterNode = cloudExplorer.available ? getAksClusterTreeNode(target, cloudExplorer) : undefined;
    const initialClusterId = clusterNode && succeeded(clusterNode) ? clusterNode.result.armId : undefined;

    const extension = getExtension();
    if (failed(extension)) {
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        return;
    }

    const panel = new KickstartPanel(extension.result.extensionUri);
    const dataProvider = new KickstartPanelDataProvider(sessionProvider.result, initialClusterId);
    panel.show(dataProvider);
}
