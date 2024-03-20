import { QuickPickItem, Uri, env, window } from "vscode";
import { failed } from "../utils/errorable";
import { SubscriptionFilter, getFilteredSubscriptions, setFilteredSubscriptions } from "../utils/config";
import { signIn } from "../../auth/azureAuth";
import { SelectionType, getSubscriptions, getTenantIds } from "../utils/subscriptions";

export async function signInToAzure(): Promise<void> {
    await signIn();
}

type SubscriptionQuickPickItem = QuickPickItem & { subscription: SubscriptionFilter };

export async function selectSubscriptions(): Promise<void> {
    const allSubscriptions = await getSubscriptions(SelectionType.All);
    if (failed(allSubscriptions)) {
        window.showErrorMessage(allSubscriptions.error);
        return;
    }

    if (allSubscriptions.result.length === 0) {
        const noSubscriptionsFound = "No subscriptions were found. Set up your account if you have yet to do so.";
        const setupAccount = "Set up Account";
        const response = await window.showInformationMessage(noSubscriptionsFound, setupAccount);
        if (response === setupAccount) {
            env.openExternal(Uri.parse("https://azure.microsoft.com/"));
        }

        return;
    }

    const tenantIds = await getTenantIds(allSubscriptions.result);

    const filteredSubscriptions = await getFilteredSubscriptions();

    const subscriptionsInKnownTenants = filteredSubscriptions.filter((sub) => tenantIds.includes(sub.tenantId));
    const subscriptionsInUnknownTenants = filteredSubscriptions.filter(
        (sub) => !subscriptionsInKnownTenants.includes(sub),
    );

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.result.map((sub) => {
        return {
            label: sub.displayName || "",
            description: sub.subscriptionId,
            picked: subscriptionsInKnownTenants.some((filtered) => filtered.subscriptionId === sub.subscriptionId),
            subscription: {
                subscriptionId: sub.subscriptionId || "",
                tenantId: sub.tenantId || "",
            },
        };
    });

    const selectedItems = await window.showQuickPick(quickPickItems, {
        canPickMany: true,
        placeHolder: "Select Subscriptions",
    });

    if (!selectedItems) {
        return;
    }

    const newFilteredSubscriptions = [
        ...selectedItems.map((item) => item.subscription),
        ...subscriptionsInUnknownTenants, // Retain filters in any tenants we don't know about.
    ];

    await setFilteredSubscriptions(newFilteredSubscriptions);
}
