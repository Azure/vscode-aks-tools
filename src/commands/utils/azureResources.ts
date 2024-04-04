import { GenericResourceExpanded } from "@azure/arm-resources";
import { getResourceManagementClient, listAll } from "./arm";
import { Errorable, map as errmap } from "./errorable";
import { parseResource } from "../../azure-api-utils";
import { ReadyAzureSessionProvider } from "../../auth/types";

export type ResourceType = "Microsoft.ContainerService/managedClusters" | "Microsoft.ContainerRegistry/registries";

/**
 * A resource with the id and name properties guaranteed to be defined.
 */
export type DefinedResource = GenericResourceExpanded & Required<Pick<GenericResourceExpanded, "id" | "name">>;

export type DefinedResourceWithGroup = DefinedResource & {
    resourceGroup: string;
};

export async function getResources(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceType: ResourceType,
): Promise<Errorable<DefinedResourceWithGroup[]>> {
    const client = getResourceManagementClient(sessionProvider, subscriptionId);
    const list = await listAll(client.resources.list({ filter: `resourceType eq '${resourceType}'` }));
    return errmap(list, (resources) => resources.filter(isDefinedResource).map(asResourceWithGroup));
}

function isDefinedResource(resource: GenericResourceExpanded): resource is DefinedResource {
    return resource.id !== undefined && resource.name !== undefined;
}

function asResourceWithGroup(resource: DefinedResource): DefinedResourceWithGroup {
    return { ...resource, resourceGroup: getResourceGroup(resource) };
}

function getResourceGroup(resource: DefinedResource): string {
    return parseResource(resource.id).resourceGroupName!;
}
