import { QuickPickItem, Uri, env, window } from "vscode";
import { ensureSignedIn, getSubscriptions, getTenantIds, signIn } from "../utils/azureSession";
import { failed } from "../utils/errorable";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { getFilteredSubscriptions, setFilteredSubscriptions } from "../utils/config";

export async function signInToAzure(): Promise<void> {
    await signIn();
}

type SubscriptionQuickPickItem = QuickPickItem & { subscription: AzureSubscription };

export async function selectSubscriptions(): Promise<void> {
    const signInResult = await ensureSignedIn();
    if (failed(signInResult)) {
        window.showErrorMessage(signInResult.error);
        return;
    }

    const allSubscriptions = await getSubscriptions(false);
    if (failed(allSubscriptions)) {
        window.showErrorMessage(allSubscriptions.error);
        return;
    }

    if (allSubscriptions.result.length === 0) {
        const noSubscriptionsFound =
            "No subscriptions were found. Setup your account if you have yet to do so or check out our troubleshooting page for common solutions to this problem.";
        const setupAccount = "Setup Account";
        const openTroubleshooting = "Open Troubleshooting";
        const response = await window.showInformationMessage(noSubscriptionsFound, setupAccount, openTroubleshooting);
        if (response === setupAccount) {
            env.openExternal(Uri.parse("https://aka.ms/AAeyf8k"));
        } else if (response === openTroubleshooting) {
            env.openExternal(Uri.parse("https://aka.ms/AAevvhr"));
        }

        return;
    }

    const tenantIds = await getTenantIds();
    if (failed(tenantIds)) {
        window.showErrorMessage(tenantIds.error);
        return;
    }

    const filteredSubscriptions = await getFilteredSubscriptions();

    const subscriptionsInKnownTenants = filteredSubscriptions.filter((sub) => tenantIds.result.includes(sub.tenantId));
    const subscriptionsInUnknownTenants = filteredSubscriptions.filter(
        (sub) => !subscriptionsInKnownTenants.includes(sub),
    );

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.result.map((sub) => {
        return {
            label: sub.name,
            description: sub.subscriptionId,
            picked: subscriptionsInKnownTenants.some((filtered) => filtered.subscriptionId === sub.subscriptionId),
            subscription: sub,
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
