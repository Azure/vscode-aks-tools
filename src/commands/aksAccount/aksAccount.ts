import { window } from "vscode";
import { failed } from "../utils/errorable";
import { getFilteredSubscriptions, setFilteredSubscriptions } from "../utils/config";
import { getSessionProvider } from "../../auth/azureSessionProvider";
import { SelectionType, SubscriptionQuickPickItem, getSubscriptions, handleNoSubscriptionsFound } from "../utils/subscriptions";
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
        sessionProvider.selectedTenant = sessionProvider.availableTenants[0];

        // If this tenant wasn't previously selected, it was probably because it wasn't immediately
        // accessible (the user's current token didn't have access to it). Calling getAuthSession
        // will prompt the user to re-authenticate if necessary.
        const sessionResult = await sessionProvider.getAuthSession();
        if (failed(sessionResult)) {
            window.showErrorMessage(sessionResult.error);
        }

        return;
    }

    const selectedTenant = await quickPickTenant(sessionProvider.availableTenants);
    if (!selectedTenant) {
        window.showInformationMessage("No tenant selected.");
        return;
    }

    sessionProvider.selectedTenant = selectedTenant;
}


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
        handleNoSubscriptionsFound();
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
    
    // show picked items at the top
    quickPickItems.sort((itemA, itemB) => (itemA.picked === itemB.picked ? 0 : itemA.picked ? -1 : 1));

    const selectedItems = await window.showQuickPick(quickPickItems, {
        canPickMany: true,
        placeHolder: "Select Subscriptions"
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
