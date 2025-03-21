import { ContainerServiceFleetClient, Fleet } from "@azure/arm-containerservicefleet";
import { getEnvironment } from "../../auth/azureAuth";
import { getDeploymentPortalUrl, getPortalResourceUrl } from "../../commands/utils/env";
import { MessageSink } from "../../webview-contract/messaging";
import { ProgressEventType, ToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/createFleet";
import { window } from "vscode";
import { API, CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { Errorable } from "./errorable";
import { FleetTreeNode } from "../../tree/fleetTreeItem";

export async function createFleet(
    client: ContainerServiceFleetClient,
    resourceGroupName: string,
    name: string,
    resource: Fleet,
    webview: MessageSink<ToWebViewMsgDef>,
) {
    const operationDescription = `Creating fleet ${name}`;
    webview.postProgressUpdate({
        event: ProgressEventType.InProgress,
        operationDescription,
        errorMessage: null,
        deploymentPortalUrl: null,
        createdFleet: null,
    });

    const environment = getEnvironment();
    try {
        const result = await client.fleets.beginCreateOrUpdateAndWait(resourceGroupName, name, resource);
        const errorMessage = `Fleet creation failed: No ID returned. 
        Resource Group Name: ${resourceGroupName}, 
        Fleet Name: ${name}, 
        Location: ${resource.location}.`;
        if (!result || !result.id) {
            window.showWarningMessage(errorMessage);
            throw new Error(errorMessage);
        }
        const deploymentPortalUrl = getDeploymentPortalUrl(environment, result.id);
        webview.postProgressUpdate({
            event: ProgressEventType.Success,
            operationDescription,
            errorMessage: null,
            deploymentPortalUrl,
            createdFleet: {
                portalUrl: getPortalResourceUrl(environment, result.id),
            },
        });
    } catch (error) {
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: (error as Error).message,
            deploymentPortalUrl: null,
            createdFleet: null,
        });
    }
}

export function getAksFleetTreeNode(
    commandTarget: unknown,
    cloudExplorer: API<CloudExplorerV1>,
): Errorable<FleetTreeNode> {
    if (!cloudExplorer.available) {
        return { succeeded: false, error: "Cloud explorer is unavailable." };
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(
        commandTarget,
    ) as CloudExplorerV1.CloudExplorerResourceNode;

    const isFleetTarget =
        cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource?.nodeType === "fleet";

    if (!isFleetTarget) {
        return { succeeded: false, error: "This command only applies to AKS Fleet managers." };
    }

    return { succeeded: true, result: cloudTarget.cloudResource };
}

function isValidFleet(fleet: Fleet): boolean {
    return (
        fleet.id !== undefined &&
        fleet.name !== undefined &&
        fleet.location !== undefined &&
        fleet.provisioningState !== undefined
    );
}

export async function getFleet(
    client: ContainerServiceFleetClient,
    resourceGroupName: string,
    name: string,
): Promise<Errorable<Fleet>> {
    try {
        const fleet = await client.fleets.get(resourceGroupName, name);
        return isValidFleet(fleet)
            ? { succeeded: true, result: fleet }
            : { succeeded: false, error: `Invalid Fleet data for ${name}` };
    } catch (e) {
        return { succeeded: false, error: `Error retrieving Fleet ${name}: ${e}` };
    }
}
