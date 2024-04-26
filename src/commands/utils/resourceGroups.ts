import { ResourceGroup } from "@azure/arm-resources";
import { getResourceManagementClient, listAll } from "./arm";
import { Errorable, map as errmap } from "./errorable";
import { ReadyAzureSessionProvider } from "../../auth/types";

/**
 * A resource group with the name and location properties guaranteed to be defined.
 */
export type DefinedResourceGroup = ResourceGroup & Required<Pick<ResourceGroup, "name" | "location">>;

export async function getResourceGroups(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Errorable<DefinedResourceGroup[]>> {
    const client = getResourceManagementClient(sessionProvider, subscriptionId);
    const groupsResult = await listAll(client.resourceGroups.list());
    return errmap(groupsResult, (groups) => groups.filter(asDefinedResourceGroup));
}

function asDefinedResourceGroup(rg: ResourceGroup): rg is DefinedResourceGroup {
    return rg.name !== undefined && rg.location !== undefined;
}
