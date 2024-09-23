import { QuickPickItem, Uri, env, window } from "vscode";
import { failed } from "../utils/errorable";
import { SubscriptionFilter, getFilteredSubscriptions, setFilteredSubscriptions } from "../utils/config";
import { getSessionProvider } from "../../auth/azureSessionProvider";
import { DefinedSubscription, SelectionType, getSubscriptions } from "../utils/subscriptions";
import { getReadySessionProvider, quickPickTenant } from "../../auth/azureAuth";
import { ReadyAzureSessionProvider } from "../../auth/types";

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

type SubscriptionQuickPickItem = QuickPickItem & { subscription: SubscriptionFilter };

export async function selectSubscriptions(): Promise<void> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    const allSubscriptions = await getAllSubscriptions(sessionProvider.result);
    if (!allSubscriptions) return;

    if (allSubscriptions.length === 0) {
        await handleNoSubscriptionsFound();
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

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.map((sub) => {
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
    quickPickItems.sort((a, b) => (a.picked === b.picked ? 0 : a.picked ? -1 : 1));

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

export async function selectSubscription(): Promise<string | undefined> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    const allSubscriptions = await getAllSubscriptions(sessionProvider.result);
    if (!allSubscriptions) return;

    if (allSubscriptions.length === 0) {
        await handleNoSubscriptionsFound();
        return;
    }

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.map((sub) => {
        return {
            label: sub.displayName || "",
            description: sub.subscriptionId,
            subscription: {
                subscriptionId: sub.subscriptionId || "",
                tenantId: sub.tenantId || "",
            },
        };
    });

    const selectedItem = await window.showQuickPick(quickPickItems, {
        canPickMany: false,
        placeHolder: "Select a Subscription",
    });

    if(!selectedItem) {
        return undefined;
    }

    return selectedItem.subscription.subscriptionId;
}

async function getAllSubscriptions(sessionProvider: ReadyAzureSessionProvider): Promise<DefinedSubscription[] | null> {
    const allSubscriptions = await getSubscriptions(sessionProvider, SelectionType.All);
    if (failed(allSubscriptions)) {
        await window.showErrorMessage(allSubscriptions.error);
        return null;
    }
    return allSubscriptions.result;
}

async function handleNoSubscriptionsFound(): Promise<void> {
    const noSubscriptionsFound = "No subscriptions were found. Set up your account if you have yet to do so.";
    const setupAccount = "Set up Account";
    const response = await window.showInformationMessage(noSubscriptionsFound, setupAccount);
    if (response === setupAccount) {
        env.openExternal(Uri.parse("https://azure.microsoft.com/"));
    }
}
