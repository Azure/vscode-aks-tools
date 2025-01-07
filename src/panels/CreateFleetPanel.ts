import { ContainerServiceFleetClient, Fleet } from "@azure/arm-containerservicefleet";

export async function createFleet(
    client: ContainerServiceFleetClient,
    resourceGroupName: string,
    name: string,
    resource: Fleet,
) {
    try {
        const result = await client.fleets.beginCreateOrUpdateAndWait(resourceGroupName, name, resource);
        return { succeeded: true, result: result.name! };
    } catch (error) {
        return { succeeded: false, error: (error as Error).message };
    }
}
