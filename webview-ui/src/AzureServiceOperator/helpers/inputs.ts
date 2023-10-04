import { InstallSettingsParams } from "../../../../src/webview-contract/webviewDefinitions/azureServiceOperator";
import { ASOState } from "./state";

export function getRequiredInputs(state: ASOState): InstallSettingsParams | null {
    const { appId, appSecret, cloudName, selectedSubscription, tenantId } = state;
    if (!appId) return null;
    if (!appSecret) return null;
    if (!cloudName) return null;
    if (!selectedSubscription) return null;
    if (!tenantId) return null;
    return { appId, appSecret, cloudName, subscriptionId: selectedSubscription.id, tenantId };
}