import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { getCredential, getEnvironment } from "../../auth/azureAuth";
import { PagedAsyncIterableIterator } from "@azure/core-paging";
import { Errorable, getErrorMessage } from "./errorable";

export function getSubscriptionClient(): SubscriptionClient {
    return new SubscriptionClient(getCredential(), { endpoint: getArmEndpoint() });
}

function getArmEndpoint(): string {
    return getEnvironment().resourceManagerEndpointUrl;
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
