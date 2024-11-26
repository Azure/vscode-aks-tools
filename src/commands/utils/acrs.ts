import { Registry } from "@azure/arm-containerregistry";
import { getAcrClient, getAcrManagementClient, listAll } from "./arm";
import { Errorable, map as errmap, getErrorMessage } from "./errorable";
import { ReadyAzureSessionProvider } from "../../auth/types";

/**
 * A registry with the id, name, location, and loginServer properties guaranteed to be defined.
 */
export type DefinedRegistry = Registry & Required<Pick<Registry, "id" | "name" | "location" | "loginServer">>;

export async function getAcrs(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: string,
): Promise<Errorable<DefinedRegistry[]>> {
    const client = getAcrManagementClient(sessionProvider, subscriptionId);
    const registriesResult = await listAll(client.registries.listByResourceGroup(resourceGroup));
    return errmap(registriesResult, (registries) => registries.filter(isDefinedRegistry));
}

export async function getAcrRegistry(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
): Promise<Errorable<DefinedRegistry>> {
    const client = getAcrManagementClient(sessionProvider, subscriptionId);
    try {
        const registryResult = await client.registries.get(resourceGroup, acrName);
        if (isDefinedRegistry(registryResult)) {
            return { succeeded: true, result: registryResult };
        }
        return {
            succeeded: false,
            error: `Failed to retrieve ACR ${acrName} in ${resourceGroup} in ${subscriptionId}`,
        };
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to retrieve ACR ${acrName} in ${resourceGroup} in ${subscriptionId}: ${getErrorMessage(e)}`,
        };
    }
}

export async function getRepositories(
    sessionProvider: ReadyAzureSessionProvider,
    registry: DefinedRegistry,
): Promise<Errorable<string[]>> {
    const acrClient = getAcrClient(sessionProvider, registry.loginServer);
    return await listAll(acrClient.listRepositoryNames());
}

export async function getRepositoryTags(
    sessionProvider: ReadyAzureSessionProvider,
    registry: DefinedRegistry,
    repositoryName: string,
): Promise<Errorable<string[]>> {
    const acrClient = getAcrClient(sessionProvider, registry.loginServer);
    const repository = await acrClient.getRepository(repositoryName);
    const propsResult = await listAll(repository.listManifestProperties());
    return errmap(propsResult, (props) => props.flatMap((p) => p.tags));
}

export async function createAcr( //TODO: proper name input checking
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
    location: string,
): Promise<Errorable<DefinedRegistry>> {
    const client = getAcrManagementClient(sessionProvider, subscriptionId);
    try {
        const registry = await client.registries.beginCreateAndWait(resourceGroup, acrName, {
            location,
            sku: {
                name: "Basic", //As quoted by azure doc, Basic SKU is the "cost optimized entry point for developers": https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus
            }, //Future: Can provide users the ability to select their desired SKU
        });
        if (isDefinedRegistry(registry)) {
            return { succeeded: true, result: registry };
        }
        return {
            succeeded: false,
            error: `Failed to create Azure Container Registry (ACR) "${acrName}" in resource group "${resourceGroup}" under subscription "${subscriptionId}".`,
        };
    } catch (error) {
        return {
            succeeded: false,
            error: `An error occurred while creating ACR "${acrName}" in resource group "${resourceGroup}" under subscription "${subscriptionId}": ${getErrorMessage(error)}`,
        };
    }
}

export async function deleteAcr(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
): Promise<Errorable<void>> {
    const client = getAcrManagementClient(sessionProvider, subscriptionId);
    try {
        await client.registries.beginDeleteAndWait(resourceGroup, acrName);
        return { succeeded: true, result: undefined };
    } catch (error) {
        return {
            succeeded: false,
            error: `An error occurred while deleting ACR "${acrName}" in resource group "${resourceGroup}" under subscription "${subscriptionId}": ${getErrorMessage(error)}`,
        };
    }
}

function isDefinedRegistry(rg: Registry): rg is DefinedRegistry {
    return rg.id !== undefined && rg.name !== undefined && rg.location !== undefined && rg.loginServer !== undefined;
}
