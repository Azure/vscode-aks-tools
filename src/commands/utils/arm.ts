import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { getCredential, getEnvironment } from "../../auth/azureAuth";
import { PagedAsyncIterableIterator } from "@azure/core-paging";

const environment = getEnvironment();
const credential = getCredential();

export function getSubscriptionClient(): SubscriptionClient {
    const endpoint = environment.resourceManagerEndpointUrl;
    return new SubscriptionClient(credential, { endpoint });
}

export async function listAll<T>(iterator: PagedAsyncIterableIterator<T>): Promise<T[]> {
    const all: T[] = [];
    for await (const page of iterator.byPage()) {
        all.push(...page);
    }
    return all;
}
