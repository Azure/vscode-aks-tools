import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { getCredential, getEnvironment } from "../../auth/azureAuth";
import { PagedAsyncIterableIterator } from "@azure/core-paging";
import { Errorable, getErrorMessage } from "./errorable";
import { ResourceManagementClient } from "@azure/arm-resources";
import { ContainerServiceClient } from "@azure/arm-containerservice";

export function getSubscriptionClient(): SubscriptionClient {
    return new SubscriptionClient(getCredential(), { endpoint: getArmEndpoint() });
}

export function getResourceManagementClient(subscriptionId: string): ResourceManagementClient {
    return new ResourceManagementClient(getCredential(), subscriptionId, { endpoint: getArmEndpoint() });
}

export function getAksClient(subscriptionId: string): ContainerServiceClient {
    return new ContainerServiceClient(getCredential(), subscriptionId, { endpoint: getArmEndpoint() });
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
