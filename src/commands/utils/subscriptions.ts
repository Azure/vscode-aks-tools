import { Subscription } from "@azure/arm-resources-subscriptions";
import { getSubscriptionClient, listAll } from "./arm";
import { Errorable, getErrorMessage, map as errmap } from "./errorable";
import { getFilteredSubscriptions } from "./config";

export enum SelectionType {
    Filtered,
    All,
}

export async function getSubscriptions(selectionType: SelectionType): Promise<Errorable<Subscription[]>> {
    const client = getSubscriptionClient();
    try {
        const subsResult = await listAll(client.subscriptions.list());
        return errmap(subsResult, (subs) => sortAndFilter(subs, selectionType));
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve subscriptions: ${getErrorMessage(e)}` };
    }
}

export function getTenantIds(subscriptions: Subscription[]): string[] {
    const duplicatedTenantIds = subscriptions.map((s) => s.tenantId).filter((t) => t !== undefined) as string[];
    return [...new Set(duplicatedTenantIds)];
}

function sortAndFilter(subscriptions: Subscription[], selectionType: SelectionType): Subscription[] {
    if (selectionType === SelectionType.Filtered) {
        const filtered = getFilteredSubscriptions();
        subscriptions = subscriptions.filter((s) => filtered.some((f) => f.subscriptionId === s.subscriptionId));
    }

    return subscriptions.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
}
