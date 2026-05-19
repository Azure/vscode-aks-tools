import type { GuardrailContribution, GuardrailInput, GuardrailResult } from "../types";

function isKubernetesManifest(content: string): boolean {
    return /apiVersion:\s*\S/.test(content) && /kind:\s*\w+/.test(content);
}

function getManifestContent(args: Record<string, unknown> | undefined): string | undefined {
    if (!args) return undefined;
    const content =
        (args["content"] as string | undefined) ??
        (args["parameters"] !== undefined && typeof args["parameters"] === "object"
            ? ((args["parameters"] as Record<string, unknown>)["content"] as string | undefined)
            : undefined);
    if (!content || typeof content !== "string") return undefined;
    if (!isKubernetesManifest(content)) return undefined;
    return content;
}

export const noHostpathVolumesGuardrail: GuardrailContribution = {
    id: "aks/no-hostpath-volumes",
    appliesTo: ["*"],
    stages: ["tool"],
    async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
        const content = getManifestContent(input.toolArgs);
        if (!content) return { verdict: "pass" };

        if (/hostPath:/m.test(content)) {
            return {
                verdict: "block",
                reason: "AKS safeguard violation: manifest contains a hostPath volume.",
            };
        }

        return { verdict: "pass" };
    },
};
