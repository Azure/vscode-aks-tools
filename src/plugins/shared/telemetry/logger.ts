import { reporter } from "../../../commands/utils/reporter";
import { SelectClusterOptions } from "../clusterOptions/selectClusterOptions";
import { CommandIdForPluginResponse } from "../types";

interface GHCopilotEventProperties {
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

    // cluster option selected by user during flow
    clusterOptionSelected?: SelectClusterOptions;

    // determine if successful manifest deployment link was clicked or not
    manifestDeploymentLinkClicked?: "true" | "false";
}
const TELEMETRY_EVENT_NAME = "aks.ghcp";

export function logGitHubCopilotPluginEvent(properties?: GHCopilotEventProperties): void {
    reporter.sendTelemetryEvent(TELEMETRY_EVENT_NAME, { ...properties });
}
