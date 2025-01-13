import {
    AzExtParentTreeItem,
    AzExtTreeItem,
    GenericTreeItem,
    ISubscriptionContext,
    TreeItemIconPath,
    registerEvent,
} from "@microsoft/vscode-azext-utils";
import { AuthenticationSession, ThemeIcon } from "vscode";
import { assetUri } from "../assets";
import { failed } from "../commands/utils/errorable";
import * as k8s from "vscode-kubernetes-tools-api";
import { createSubscriptionTreeItem } from "./subscriptionTreeItem";
import { getFilteredSubscriptionsChangeEvent } from "../commands/utils/config";
import { getCredential, getEnvironment } from "../auth/azureAuth";
import { SelectionType, getSubscriptions } from "../commands/utils/subscriptions";
import { Subscription } from "@azure/arm-resources-subscriptions";
import { AzureSessionProvider, ReadyAzureSessionProvider, isReady } from "../auth/types";
import { TokenCredential } from "@azure/identity";

export function createAzureAccountTreeItem(
    sessionProvider: AzureSessionProvider,
): AzExtParentTreeItem & { dispose(): unknown } {
    return new AzureAccountTreeItem(sessionProvider);
}

class AzureAccountTreeItem extends AzExtParentTreeItem {
    private subscriptionTreeItems: AzExtTreeItem[] | undefined;

    constructor(private readonly sessionProvider: AzureSessionProvider) {
        super(undefined);
        this.autoSelectInTreeItemPicker = true;

        const onStatusChange = this.sessionProvider.signInStatusChangeEvent;
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

        switch (this.sessionProvider.signInStatus) {
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

        if (this.sessionProvider.selectedTenant === null && this.sessionProvider.availableTenants.length > 1) {
            // Signed in, but no tenant selected, AND there is more than one tenant to choose from.
            return [
                new GenericTreeItem(this, {
                    label: "Select tenant...",
                    commandId: "aks.selectTenant",
                    contextValue: "azureCommand",
                    id: "aksAccountSelectTenant",
                    iconPath: new ThemeIcon("account"),
                    includeInTreeItemPicker: true,
                }),
            ];
        }

        // Either we have a selected tenant, or there is only one available tenant and it's not selected
        // because it requires extra interaction. Calling `getAuthSession` will complete that process.
        // We will need the returned auth session in any case for creating a subscription context.
        const session = await this.sessionProvider.getAuthSession();
        if (failed(session) || !isReady(this.sessionProvider)) {
            return [
                new GenericTreeItem(this, {
                    label: "Error authenticating",
                    contextValue: "azureCommand",
                    id: "aksAccountError",
                    iconPath: new ThemeIcon("error"),
                }),
            ];
        }

        const subscriptions = await getSubscriptions(this.sessionProvider, SelectionType.AllIfNoFilters);
        if (failed(subscriptions)) {
            return [
                new GenericTreeItem(this, {
                    label: "Error loading subscriptions",
                    contextValue: "azureCommand",
                    id: "aksAccountError",
                    iconPath: new ThemeIcon("error"),
                    description: subscriptions.error,
                }),
            ];
        }

        if (subscriptions.result.length === 0) {
            return [
                new GenericTreeItem(this, {
                    label: "No subscriptions found",
                    contextValue: "azureCommand",
                    id: "aksAccountNoSubs",
                    iconPath: new ThemeIcon("info"),
                }),
            ];
        }

        // We've confirmed above that the provider is ready.
        const readySessionProvider: ReadyAzureSessionProvider = this.sessionProvider;

        this.subscriptionTreeItems = await Promise.all(
            subscriptions.result.map(async (subscription) => {
                const existingTreeItem: AzExtTreeItem | undefined = existingSubscriptionTreeItems.find(
                    (ti) => ti.id === subscription.subscriptionId,
                );
                if (existingTreeItem) {
                    // Return existing treeItem (which might have many 'cached' tree items underneath it) rather than creating a brand new tree item every time
                    return existingTreeItem;
                } else {
                    const subscriptionContext = getSubscriptionContext(
                        readySessionProvider,
                        session.result,
                        subscription,
                    );
                    return await createSubscriptionTreeItem(this, readySessionProvider, subscriptionContext);
                }
            }),
        );

        return this.subscriptionTreeItems;
    }
}

function getSubscriptionContext(
    sessionProvider: ReadyAzureSessionProvider,
    session: AuthenticationSession,
    subscription: Subscription,
): ISubscriptionContext {
    const credentials = getCredential(sessionProvider);
    const environment = getEnvironment();

    return {
        credentials,
        subscriptionDisplayName: subscription.displayName || "",
        subscriptionId: subscription.subscriptionId || "",
        subscriptionPath: `/subscriptions/${subscription.subscriptionId}`,
        tenantId: subscription.tenantId || "",
        userId: session.account.id,
        environment,
        isCustomCloud: environment.name === "AzureCustomCloud",
        createCredentialsForScopes: async (scopes: string[]): Promise<TokenCredential> => {
            const authSession = await sessionProvider.getAuthSession({ scopes });
            if (failed(authSession)) {
                throw new Error(`No Microsoft authentication session found: ${authSession.error}`);
            }

            return {
                getToken: async () => {
                    return { token: authSession.result.accessToken, expiresOnTimestamp: 0 };
                },
            };
        },
    };
}
