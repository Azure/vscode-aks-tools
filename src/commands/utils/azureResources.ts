import { GenericResourceExpanded } from "@azure/arm-resources";
import { getResourceManagementClient, listAll } from "./arm";
import { Errorable, map as errmap } from "./errorable";
import { parseResource } from "../../azure-api-utils";
import { ReadyAzureSessionProvider } from "../../auth/types";

export const clusterProvider = "Microsoft.ContainerService";
export const acrProvider = "Microsoft.ContainerRegistry";

export const clusterResourceName = "managedClusters";
export const acrResourceName = "registries";

export const clusterResourceType = `${clusterProvider}/${clusterResourceName}`;
export const acrResourceType = `${acrProvider}/${acrResourceName}`;

export const resourceTypes = [clusterResourceType, acrResourceType] as const;
export type ResourceType = (typeof resourceTypes)[number];

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
