import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ContainerRegistryManagementClient } from "@azure/arm-containerregistry";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import { FeatureClient } from "@azure/arm-features";
import { MonitorClient } from "@azure/arm-monitor";
import { ManagedServiceIdentityClient } from "@azure/arm-msi";
import { ResourceManagementClient } from "@azure/arm-resources";
import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { StorageManagementClient } from "@azure/arm-storage";
import { ContainerRegistryClient } from "@azure/container-registry";
import { PagedAsyncIterableIterator } from "@azure/core-paging";
import { getCredential, getEnvironment } from "../../auth/azureAuth";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { Errorable, getErrorMessage } from "./errorable";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ContainerServiceFleetClient } from "@azure/arm-containerservicefleet";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

export function getSubscriptionClient(sessionProvider: ReadyAzureSessionProvider): SubscriptionClient {
    return new SubscriptionClient(getCredential(sessionProvider), { endpoint: getArmEndpoint() });
}

export function getResourceManagementClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): ResourceManagementClient {
    return new ResourceManagementClient(getCredential(sessionProvider), subscriptionId, { endpoint: getArmEndpoint() });
}

export function getFeatureClient(sessionProvider: ReadyAzureSessionProvider, subscriptionId: string): FeatureClient {
    return new FeatureClient(getCredential(sessionProvider), subscriptionId);
}

export function getAksClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): ContainerServiceClient {
    return new ContainerServiceClient(getCredential(sessionProvider), subscriptionId, { endpoint: getArmEndpoint() });
}

export function getGraphResourceClient(sessionProvider: ReadyAzureSessionProvider): ResourceGraphClient {
    return new ResourceGraphClient(getCredential(sessionProvider));
}

export function getAksFleetClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): ContainerServiceFleetClient {
    return new ContainerServiceFleetClient(getCredential(sessionProvider), subscriptionId, {
        endpoint: getArmEndpoint(),
    });
}

export function getMonitorClient(sessionProvider: ReadyAzureSessionProvider, subscriptionId: string): MonitorClient {
    return new MonitorClient(getCredential(sessionProvider), subscriptionId, { endpoint: getArmEndpoint() });
}

export function getStorageManagementClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): StorageManagementClient {
    return new StorageManagementClient(getCredential(sessionProvider), subscriptionId, { endpoint: getArmEndpoint() });
}

export function getAcrManagementClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): ContainerRegistryManagementClient {
    return new ContainerRegistryManagementClient(getCredential(sessionProvider), subscriptionId, {
        endpoint: getArmEndpoint(),
    });
}

export function getAcrClient(
    sessionProvider: ReadyAzureSessionProvider,
    registryLoginServer: string,
): ContainerRegistryClient {
    // Endpoint should be in the form of "https://myregistryname.azurecr.io"
    return new ContainerRegistryClient(`https://${registryLoginServer}`, getCredential(sessionProvider));
}

export function getAuthorizationManagementClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): AuthorizationManagementClient {
    return new AuthorizationManagementClient(getCredential(sessionProvider), subscriptionId, {
        endpoint: getArmEndpoint(),
    });
}

export function getManagedServiceIdentityClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): ManagedServiceIdentityClient {
    return new ManagedServiceIdentityClient(getCredential(sessionProvider), subscriptionId);
}

export function getComputeManagementClient(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): ComputeManagementClient {
    return new ComputeManagementClient(getCredential(sessionProvider), subscriptionId, { endpoint: getArmEndpoint() });
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
