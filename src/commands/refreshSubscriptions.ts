import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionNode } from "./utils/clusters";
import { failed } from "./utils/errorable";

export default async function refreshSubscription(context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
        const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);
        if (failed(subscriptionNode)) {
            return;
        }

        subscriptionNode.result.treeDataProvider.refresh(context, subscriptionNode.result.treeItem);
    }
}
