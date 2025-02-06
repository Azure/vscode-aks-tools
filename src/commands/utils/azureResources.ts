import { GenericResourceExpanded } from "@azure/arm-resources";
import { getResourceManagementClient, listAll, getAksFleetClient, getGraphResourceClient } from "./arm";
import { Errorable, map as errmap } from "./errorable";
import { parseResource } from "../../azure-api-utils";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { FleetMember } from "@azure/arm-containerservicefleet";
import { AksCluster } from "./config";

export const clusterProvider = "Microsoft.ContainerService";
export const acrProvider = "Microsoft.ContainerRegistry";

export const fleetResourceName = "fleets";
export const clusterResourceName = "managedClusters";
export const fleetMembershipsResourceName = "fleetMemberships";
export const acrResourceName = "registries";

export const clusterResourceType = `${clusterProvider}/${clusterResourceName}`;
export const fleetMembershipResourceType = `${clusterProvider}/${fleetMembershipsResourceName}`;
export const acrResourceType = `${acrProvider}/${acrResourceName}`;
export const fleetResourceType = `${clusterProvider}/${fleetResourceName}`;

export const resourceTypes = [
    clusterResourceType,
    acrResourceType,
    fleetResourceType,
    fleetMembershipResourceType,
] as const;
export type ResourceType = (typeof resourceTypes)[number];

/**
 * A resource with the id and name properties guaranteed to be defined.
 */
export type DefinedResource = GenericResourceExpanded & Required<Pick<GenericResourceExpanded, "id" | "name">>;

export type DefinedResourceWithGroup = DefinedResource & {
    resourceGroup: string;
};

export type DefinedFleetMemberWithGroup = DefinedResourceWithGroup & {
    clusterResourceId: string;
    parentResourceId: string;
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

export async function getClusterAndFleetResourcesFromGraphAPI(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Errorable<AksCluster[]>> {
    const client = getGraphResourceClient(sessionProvider);
    const query = {
        query: `Resources | where type =~ '${clusterResourceType}' or type =~ '${fleetResourceType}' | project id, name, location, resourceGroup, subscriptionId, type`,
        subscriptions: [subscriptionId],
    };

    try {
        const response = await client.resources(query);

        const aksClusters: AksCluster[] = response.data.map((resource: AksCluster) => ({
            id: resource.id,
            name: resource.name,
            location: resource.location,
            resourceGroup: resource.resourceGroup,
            subscriptionId: resource.subscriptionId,
            type: resource.type,
        }));
        return errmap({ succeeded: true, result: aksClusters }, (resources) => resources);
    } catch (error) {
        console.error("Error fetching AKS clusters:", error);
        return { succeeded: false, error: error as string };
    }
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

function asFleetMemberWithGroup(member: FleetMember): DefinedFleetMemberWithGroup {
    return {
        resourceGroup: parseResource(member.id!).resourceGroupName!,
        id: member.id!,
        name: member.name!,
        clusterResourceId: member.clusterResourceId!,
        parentResourceId: parseResource(member.id!).parentResourceId!,
    };
}

export async function getFleetMembers(
    sessionProvider: ReadyAzureSessionProvider,
    fleet: DefinedResourceWithGroup,
): Promise<Errorable<DefinedFleetMemberWithGroup[]>> {
    const subId = parseResource(fleet.id).subscriptionId!;
    const client = getAksFleetClient(sessionProvider, subId);
    const allFleetMembers = await listAll(client.fleetMembers.listByFleet(fleet.resourceGroup, fleet.name));
    return errmap(allFleetMembers, (members) => members.map(asFleetMemberWithGroup));
}
