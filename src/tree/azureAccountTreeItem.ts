import {
    AzExtParentTreeItem,
    AzExtTreeItem,
    GenericTreeItem,
    TreeItemIconPath,
    registerEvent,
} from "@microsoft/vscode-azext-utils";
import { ThemeIcon } from "vscode";
import { assetUri } from "../assets";
import { failed } from "../commands/utils/errorable";
import * as k8s from "vscode-kubernetes-tools-api";
import { createSubscriptionTreeItem } from "./subscriptionTreeItem";
import {
    getAuthSession,
    getSignInStatus,
    getSignInStatusChangeEvent,
    getSubscriptionContext,
    getSubscriptions,
} from "../commands/utils/azureSession";
import { getFilteredSubscriptionsChangeEvent } from "../commands/utils/config";

export function createAzureAccountTreeItem(): AzExtParentTreeItem & { dispose(): unknown } {
    return new AzureAccountTreeItem();
}

class AzureAccountTreeItem extends AzExtParentTreeItem {
    private subscriptionTreeItems: AzExtTreeItem[] | undefined;

    constructor() {
        super(undefined);
        this.autoSelectInTreeItemPicker = true;

        const onStatusChange = getSignInStatusChangeEvent();
        const onFilteredSubscriptionsChange = getFilteredSubscriptionsChangeEvent();
        registerEvent("azureAccountTreeItem.onSignInStatusChange", onStatusChange, (context) => this.refresh(context));
        registerEvent("azureAccountTreeItem.onSubscriptionFilterChange", onFilteredSubscriptionsChange, (context) =>
            this.refresh(context),
        );
    }

    public override get label() {
        return "Azure";
    }

    public override get contextValue() {
        return "aks.azureAccount";
    }

    public override get iconPath(): TreeItemIconPath {
        return assetUri("resources/azure.svg");
    }

    public async refreshImpl?(): Promise<void> {
        // NOTE: Updates to the subscription filter would normally refresh this node. However,
        //       the Cloud Explorer wraps this node with its own and doesn't listen for change
        //       events. Hence, we must force Cloud Explorer to refresh, which will then re-
        //       enumerate this node's children.
        const cloudExplorer = await k8s.extension.cloudExplorer.v1;

        if (cloudExplorer.available) {
            cloudExplorer.api.refresh();
        }
    }

    public dispose(): void {}

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<AzExtTreeItem[]> {
        const existingSubscriptionTreeItems: AzExtTreeItem[] = this.subscriptionTreeItems || [];
        this.subscriptionTreeItems = [];

        switch (getSignInStatus()) {
            case "Initializing":
                return [
                    new GenericTreeItem(this, {
                        label: "Loading...",
                        contextValue: "azureCommand",
                        id: "aksAccountLoading",
                        iconPath: new ThemeIcon("loading~spin"),
                    }),
                ];
            case "SignedOut":
                return [
                    new GenericTreeItem(this, {
                        label: "Sign in to Azure...",
                        commandId: "aks.signInToAzure",
                        contextValue: "azureCommand",
                        id: "aksAccountSignIn",
                        iconPath: new ThemeIcon("sign-in"),
                        includeInTreeItemPicker: true,
                    }),
                ];
            case "SigningIn":
                return [
                    new GenericTreeItem(this, {
                        label: "Waiting for Azure sign-in...",
                        contextValue: "azureCommand",
                        id: "aksAccountSigningIn",
                        iconPath: new ThemeIcon("loading~spin"),
                    }),
                ];
        }

        const subscriptions = await getSubscriptions(true);
        if (failed(subscriptions)) {
            return [
                new GenericTreeItem(this, {
                    label: "Error loading subscriptions",
                    contextValue: "azureCommand",
                    id: "aksAccountError",
                    iconPath: new ThemeIcon("error"),
                }),
            ];
        }

        if (subscriptions.result.length === 0) {
            return [
                new GenericTreeItem(this, {
                    label: "Select Subscriptions...",
                    commandId: "aks.selectSubscriptions",
                    contextValue: "azureCommand",
                    id: "aksAccountSelectSubscriptions",
                    includeInTreeItemPicker: true,
                }),
            ];
        }

        const session = await getAuthSession();
        if (failed(session)) {
            return [
                new GenericTreeItem(this, {
                    label: "Loading...",
                    contextValue: "azureCommand",
                    id: "aksAccountLoading",
                    iconPath: new ThemeIcon("loading~spin"),
                }),
            ];
        }

        this.subscriptionTreeItems = await Promise.all(
            subscriptions.result.map(async (subscription) => {
                const existingTreeItem: AzExtTreeItem | undefined = existingSubscriptionTreeItems.find(
                    (ti) => ti.id === subscription.subscriptionId,
                );
                if (existingTreeItem) {
                    // Return existing treeItem (which might have many 'cached' tree items underneath it) rather than creating a brand new tree item every time
                    return existingTreeItem;
                } else {
                    const subscriptionContext = getSubscriptionContext(session.result, subscription);
                    return await createSubscriptionTreeItem(this, subscriptionContext);
                }
            }),
        );

        return this.subscriptionTreeItems;
    }
}
