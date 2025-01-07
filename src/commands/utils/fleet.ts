import { ContainerServiceFleetClient, Fleet } from "@azure/arm-containerservicefleet";
import { Errorable } from "./errorable";

export async function fleetCreate(
    client: ContainerServiceFleetClient,
    resourceGroupName: string,
    fleetName: string,
    resource: Fleet,
): Promise<Errorable<string>> {
    try {
        const result = await client.fleets.beginCreateOrUpdateAndWait(resourceGroupName, fleetName, resource);
        return { succeeded: true, result: result.name! };
    } catch (error) {
        return { succeeded: false, error: (error as Error).message };
    }
}
