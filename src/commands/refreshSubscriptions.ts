import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem } from "./utils/clusters";
import { failed } from "./utils/errorable";

export default async function refreshSubscription(context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
        const subscriptionItem = getAksClusterSubscriptionItem(target, cloudExplorer);
        if (failed(subscriptionItem)) {
            return;
        }

        const subscriptionNode = subscriptionItem.result;
        subscriptionNode.treeDataProvider.refresh(context, subscriptionNode.treeItem);
    }
}
