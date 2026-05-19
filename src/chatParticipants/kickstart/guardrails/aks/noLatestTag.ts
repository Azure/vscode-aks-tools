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

const EXPLICIT_LATEST_PATTERN = /^\s+image:\s*\S+:latest\s*$/m;

export const noLatestTagGuardrail: GuardrailContribution = {
    id: "aks/no-latest-tag",
    appliesTo: ["*"],
    stages: ["tool"],
    async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
        const content = getManifestContent(input.toolArgs);
        if (!content) return { verdict: "pass" };

        if (EXPLICIT_LATEST_PATTERN.test(content)) {
            return {
                verdict: "block",
                reason: "AKS safeguard violation: manifest uses :latest image tag.",
            };
        }

        return { verdict: "pass" };
    },
};
