import { Subscription, SubscriptionsGetResponse } from "@azure/arm-resources-subscriptions";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getSubscriptionClient, listAll } from "./arm";
import { getFilteredSubscriptions, SubscriptionFilter } from "./config";
import { Errorable, map as errmap } from "./errorable";
import { env, QuickPickItem, Uri, window } from "vscode";

export enum SelectionType {
    Filtered,
    All,
    AllIfNoFilters,
}

/**
 * A subscription with the subscriptionId and displayName properties guaranteed to be defined.
 */
export type DefinedSubscription = Subscription & Required<Pick<Subscription, "subscriptionId" | "displayName">>;

export type SubscriptionQuickPickItem = QuickPickItem & { subscription: SubscriptionFilter };

export async function getSubscriptions(
    sessionProvider: ReadyAzureSessionProvider,
    selectionType: SelectionType,
): Promise<Errorable<DefinedSubscription[]>> {
    const client = getSubscriptionClient(sessionProvider);
    const subsResult = await listAll(client.subscriptions.list());
    return errmap(subsResult, (subs) => sortAndFilter(subs.filter(isDefinedSubscription), selectionType));
}

function sortAndFilter(subscriptions: DefinedSubscription[], selectionType: SelectionType): DefinedSubscription[] {
    const attemptFilter = selectionType === SelectionType.Filtered || selectionType === SelectionType.AllIfNoFilters;
    if (attemptFilter) {
        const filters = getFilteredSubscriptions();
        const filteredSubs = subscriptions.filter((s) => filters.some((f) => f.subscriptionId === s.subscriptionId));
        const returnAll = selectionType === SelectionType.AllIfNoFilters && filteredSubs.length === 0;
        if (!returnAll) {
            subscriptions = filteredSubs;
        }
    }

    return subscriptions.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function isDefinedSubscription(sub: Subscription): sub is DefinedSubscription {
    return sub.subscriptionId !== undefined && sub.displayName !== undefined;
}

function isDefinedSubscriptionGetResponse(sub: SubscriptionsGetResponse): sub is DefinedSubscription {
    return sub.subscriptionId !== undefined && sub.displayName !== undefined;
}

export async function getSubscription(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Errorable<DefinedSubscription>> {
    const client = getSubscriptionClient(sessionProvider);
    const subResult: SubscriptionsGetResponse = await client.subscriptions.get(subscriptionId);
    if (!isDefinedSubscriptionGetResponse(subResult)) {
        return { succeeded: false, error: "Subscription is not found" };
    }
    return { succeeded: true, result: subResult };
}

export function handleNoSubscriptionsFound(): void {
    const noSubscriptionsFound = "No subscriptions were found. Set up your account if you have yet to do so.";
    const setupAccount = "Set up Account";
    window.showInformationMessage(noSubscriptionsFound, setupAccount).then((res) => {
        if (res === setupAccount) {
            env.openExternal(Uri.parse("https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/"));
        }
    });
}
