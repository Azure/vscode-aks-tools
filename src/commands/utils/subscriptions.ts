import { Subscription } from "@azure/arm-resources-subscriptions";
import { getSubscriptionClient, listAll } from "./arm";
import { Errorable, map as errmap } from "./errorable";
import { getFilteredSubscriptions } from "./config";
import { ReadyAzureSessionProvider } from "../../auth/types";

export enum SelectionType {
    Filtered,
    All,
    AllIfNoFilters,
}

/**
 * A subscription with the subscriptionId and displayName properties guaranteed to be defined.
 */
export type DefinedSubscription = Subscription & Required<Pick<Subscription, "subscriptionId" | "displayName">>;

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
