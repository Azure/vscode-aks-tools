import { reporter } from "../../../commands/utils/reporter";
import { SelectClusterOptions } from "../clusterOptions/selectClusterOptions";
import { CommandIdForPluginResponse } from "../types";

interface GHCopilotEventProperties {
    // determine if the event is from GH Copilot
    isGHCopilotEvent?: "true" | "false";

    // command that invoked the telemetry event, log only the VS Code command Id
    commandId?: CommandIdForPluginResponse;

    // determine if subscription was successfully selected or not during flow
    subscriptionSelected?: "true" | "false";

    // determine if manifest was successfully selected or not during flow
    manifestSelected?: "true" | "false";

    // determine if cluster was successfully selected or not during flow
    clusterSelected?: "true" | "false";

    // determine if manifest deployment was cancelled or not during flow
    manifestDeploymentCancelled?: "true" | "false";

    // determine if manifest deployment was successful or not during flow
    manifestDeploymentSuccess?: "true" | "false";

    // command that was generated from GitHub Copilot handler and copied into Kubectl panel
    kubectlCommandGenerated?: string;

    // cluster option selected by user during flow
    clusterOptionSelected?: SelectClusterOptions;

    // determine if successful manifest deployment link was clicked or not
    manifestDeploymentLinkClicked?: "true" | "false";
}
const TELEMETRY_EVENT_NAME = "aks.ghcp";

export function logGitHubCopilotPluginEvent(properties?: GHCopilotEventProperties): void {
    const isGHCopilotEvent = properties?.isGHCopilotEvent || "true";
    reporter.sendTelemetryEvent(TELEMETRY_EVENT_NAME, { isGHCopilotEvent, ...properties });
}
