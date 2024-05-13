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

function isDefinedRegistry(rg: Registry): rg is DefinedRegistry {
    return rg.id !== undefined && rg.name !== undefined && rg.location !== undefined && rg.loginServer !== undefined;
}
