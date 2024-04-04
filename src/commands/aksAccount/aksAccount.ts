import { QuickPickItem, Uri, env, window } from "vscode";
import { failed } from "../utils/errorable";
import { SubscriptionFilter, getFilteredSubscriptions, setFilteredSubscriptions } from "../utils/config";
import { getSessionProvider } from "../../auth/azureSessionProvider";
import { SelectionType, getSubscriptions } from "../utils/subscriptions";
import { getReadySessionProvider, quickPickTenant } from "../../auth/azureAuth";

export async function signInToAzure(): Promise<void> {
    await getSessionProvider().signIn();
}

export async function selectTenant(): Promise<void> {
    const sessionProvider = getSessionProvider();
    if (sessionProvider.signInStatus !== "SignedIn") {
        window.showInformationMessage("You must sign in before selecting a tenant.");
        return;
    }

    if (sessionProvider.availableTenants.length === 1) {
        window.showInformationMessage(`Only one tenant available (${sessionProvider.availableTenants[0].name}).`);
        return;
    }

    const selectedTenant = await quickPickTenant(sessionProvider.availableTenants);
    if (!selectedTenant) {
        window.showInformationMessage("No tenant selected.");
        return;
    }

    sessionProvider.selectedTenant = selectedTenant;
}

type SubscriptionQuickPickItem = QuickPickItem & { subscription: SubscriptionFilter };

export async function selectSubscriptions(): Promise<void> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    const allSubscriptions = await getSubscriptions(sessionProvider.result, SelectionType.All);
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

    const session = await sessionProvider.result.getAuthSession();
    if (failed(session)) {
        window.showErrorMessage(session.error);
        return;
    }

    const filteredSubscriptions = await getFilteredSubscriptions();

    const subscriptionsInCurrentTenant = filteredSubscriptions.filter(
        (sub) => sub.tenantId === session.result.tenantId,
    );
    const subscriptionsInOtherTenants = filteredSubscriptions.filter((sub) => sub.tenantId !== session.result.tenantId);

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.result.map((sub) => {
        return {
            label: sub.displayName || "",
            description: sub.subscriptionId,
            picked: subscriptionsInCurrentTenant.some((filtered) => filtered.subscriptionId === sub.subscriptionId),
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
        ...subscriptionsInOtherTenants, // Retain filters in any other tenants.
    ];

    await setFilteredSubscriptions(newFilteredSubscriptions);
}
