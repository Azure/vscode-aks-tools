import { commands, window } from "vscode";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { failed, succeeded } from "../utils/errorable";
import { InitialSelection } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { AttachAcrToClusterDataProvider, AttachAcrToClusterPanel } from "../../panels/AttachAcrToClusterPanel";
import { getExtension } from "../utils/host";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAksClusterTreeNode } from "../utils/clusters";

export type AttachAcrToClusterParams = {
    initialSelection?: InitialSelection;
};

/**
 * Allows the command to be invoked programmatically, in this case from the message handler
 * of the 'Draft Workflow' webview.
 */
export function launchAttachAcrToClusterCommand(params: AttachAcrToClusterParams) {
    commands.executeCommand("aks.attachAcrToCluster", params);
}

export async function attachAcrToCluster(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const params = getAttachAcrToClusterParams(cloudExplorer, target);

    const extension = getExtension();
    if (failed(extension)) {
        window.showErrorMessage(extension.error);
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    // Explicitly pass empty initialSelection if not defined.
    const initialSelection = params?.initialSelection || {};

    const panel = new AttachAcrToClusterPanel(extension.result.extensionUri);
    const dataProvider = new AttachAcrToClusterDataProvider(sessionProvider.result, initialSelection);
    panel.show(dataProvider);
}

function getAttachAcrToClusterParams(
    cloudExplorer: k8s.API<k8s.CloudExplorerV1>,
    params: unknown,
): AttachAcrToClusterParams {
    const clusterNode = getAksClusterTreeNode(params, cloudExplorer);
    if (succeeded(clusterNode)) {
        return {
            initialSelection: {
                subscriptionId: clusterNode.result.subscriptionId,
                clusterResourceGroup: clusterNode.result.resourceGroupName,
                clusterName: clusterNode.result.name,
            },
        };
    }

    return params as AttachAcrToClusterParams;
}
