export type { GuardrailStage, GuardrailInput, GuardrailResult, GuardrailContribution } from "./types";
export { runGuardrails, applyRedact } from "./engine";
export type { RunGuardrailsResult } from "./engine";

import { noCredentialLeakGuardrail } from "./core/noCredentialLeak";
import { noSecretsInArtifactsGuardrail } from "./core/noSecretsInArtifacts";
import { noPiiInLogsGuardrail } from "./core/noPiiInLogs";
import { noPrivilegedContainersGuardrail } from "./aks/noPrivilegedContainers";
import { requireResourceLimitsGuardrail } from "./aks/requireResourceLimits";
import { noHostpathVolumesGuardrail } from "./aks/noHostpathVolumes";
import { noLatestTagGuardrail } from "./aks/noLatestTag";
import type { GuardrailContribution } from "./types";

export {
    noCredentialLeakGuardrail,
    noSecretsInArtifactsGuardrail,
    noPiiInLogsGuardrail,
    noPrivilegedContainersGuardrail,
    requireResourceLimitsGuardrail,
    noHostpathVolumesGuardrail,
    noLatestTagGuardrail,
};

export function getDefaultGuardrails(): GuardrailContribution[] {
    return [
        noCredentialLeakGuardrail,
        noSecretsInArtifactsGuardrail,
        noPiiInLogsGuardrail,
        noPrivilegedContainersGuardrail,
        requireResourceLimitsGuardrail,
        noHostpathVolumesGuardrail,
        noLatestTagGuardrail,
    ];
}
