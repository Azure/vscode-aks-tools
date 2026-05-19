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

export const requireResourceLimitsGuardrail: GuardrailContribution = {
    id: "aks/require-resource-limits",
    appliesTo: ["*"],
    stages: ["tool"],
    async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
        const content = getManifestContent(input.toolArgs);
        if (!content) return { verdict: "pass" };

        const hasContainers = /^\s+containers:/m.test(content);
        if (!hasContainers) return { verdict: "pass" };

        const hasLimits = /^\s+limits:/m.test(content);
        if (!hasLimits) {
            return {
                verdict: "block",
                reason: "AKS safeguard violation: manifest has containers without resource limits.",
            };
        }

        return { verdict: "pass" };
    },
};
