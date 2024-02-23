import { Registry } from "@azure/arm-containerregistry";
import { getAcrClient, getAcrManagementClient, listAll } from "./arm";
import { Errorable, map as errmap, getErrorMessage } from "./errorable";

/**
 * A registry with the id, name, location, and loginServer properties guaranteed to be defined.
 */
export type DefinedRegistry = Registry & Required<Pick<Registry, "id" | "name" | "location" | "loginServer">>;

export async function getAcrs(subscriptionId: string, resourceGroup: string): Promise<Errorable<DefinedRegistry[]>> {
    const client = getAcrManagementClient(subscriptionId);
    const registriesResult = await listAll(client.registries.listByResourceGroup(resourceGroup));
    return errmap(registriesResult, (registries) => registries.filter(asDefinedRegistry));
}

export async function getAcrRegistry(
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
): Promise<Errorable<DefinedRegistry>> {
    const client = getAcrManagementClient(subscriptionId);
    try {
        const registryResult = await client.registries.get(resourceGroup, acrName);
        if (asDefinedRegistry(registryResult)) {
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

export async function getRepositories(registry: DefinedRegistry): Promise<Errorable<string[]>> {
    const acrClient = getAcrClient(registry.loginServer);
    return await listAll(acrClient.listRepositoryNames());
}

export async function getRepositoryTags(
    registry: DefinedRegistry,
    repositoryName: string,
): Promise<Errorable<string[]>> {
    const acrClient = getAcrClient(registry.loginServer);
    const repository = await acrClient.getRepository(repositoryName);
    const propsResult = await listAll(repository.listManifestProperties());
    return errmap(propsResult, (props) => props.flatMap((p) => p.tags));
}

function asDefinedRegistry(rg: Registry): rg is DefinedRegistry {
    return rg.id !== undefined && rg.name !== undefined && rg.location !== undefined && rg.loginServer !== undefined;
}
