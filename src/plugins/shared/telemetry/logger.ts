import { reporter } from "../../../commands/utils/reporter";
import { SelectClusterOptions } from "../clusterOptions/selectClusterOptions";
import { CommandIdForPluginResponse } from "../types";

interface EventProperties {
    // command that invoked the telemetry event, log only the command Id
    commandId?: CommandIdForPluginResponse;

    // determine if subscription was successfully selected or not
    subscriptionSelected?: "true" | "false";

    // determine if manifest was successfully selected or not
    manifestSelected?: "true" | "false";

    // determine if cluster was successfully selected or not
    clusterSelected?: "true" | "false";

    // determine if deployment was cancelled or not
    deploymentCancelled?: "true" | "false";

    // determine if deployment was successful or not
    deploymentSuccess?: "true" | "false";

    // command that was generated from ghcp handler and copied into Kubectl panel
    kubectlCommand?: string;

    // cluster option selected by user
    clusterOptionSelected?: SelectClusterOptions;

    // determine if successful manifest deployment link was clicked or not
    successfulManifestDeploymentLinkClicked?: "true" | "false";
}

const TELEMETRY_EVENT_NAME = "aks.ghcp";

export function logPluginHandlerEvent(properties?: EventProperties): void {
    reporter.sendTelemetryEvent(TELEMETRY_EVENT_NAME, { ...properties });
}
