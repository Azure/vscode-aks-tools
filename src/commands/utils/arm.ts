import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { getCredential, getEnvironment } from "../../auth/azureAuth";
import { PagedAsyncIterableIterator } from "@azure/core-paging";
import { Errorable, getErrorMessage } from "./errorable";

const environment = getEnvironment();
const credential = getCredential();

export function getSubscriptionClient(): SubscriptionClient {
    const endpoint = environment.resourceManagerEndpointUrl;
    return new SubscriptionClient(credential, { endpoint });
}

export async function listAll<T>(iterator: PagedAsyncIterableIterator<T>): Promise<Errorable<T[]>> {
    const result: T[] = [];
    try {
        for await (const page of iterator.byPage()) {
            result.push(...page);
        }
        return { succeeded: true, result };
    } catch (e) {
        return { succeeded: false, error: `Failed to list resources: ${getErrorMessage(e)}` };
    }
}
