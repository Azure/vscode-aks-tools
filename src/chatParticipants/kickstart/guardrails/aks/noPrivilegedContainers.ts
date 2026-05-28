import type { GuardrailContribution, GuardrailInput, GuardrailResult } from "../types";

function isKubernetesManifest(content: string): boolean {
    return /apiVersion:\s*\S/.test(content) && /kind:\s*\w+/.test(content);
}

const DANGEROUS_CAPS = ["SYS_ADMIN", "NET_ADMIN", "ALL", "SYS_PTRACE", "SYS_MODULE", "DAC_READ_SEARCH"];

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

export const noPrivilegedContainersGuardrail: GuardrailContribution = {
    id: "aks/no-privileged-containers",
    appliesTo: ["*"],
    stages: ["tool"],
    async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
        const content = getManifestContent(input.toolArgs);
        if (!content) return { verdict: "pass" };

        if (/privileged:\s*true/.test(content)) {
            return {
                verdict: "block",
                reason: "AKS safeguard violation: manifest contains privileged container (securityContext.privileged: true).",
            };
        }

        if (/allowPrivilegeEscalation:\s*true/.test(content)) {
            return {
                verdict: "block",
                reason: "AKS safeguard violation: manifest sets allowPrivilegeEscalation: true.",
            };
        }

        const foundCap = DANGEROUS_CAPS.find((cap) => new RegExp(`-\\s+${cap}\\b`, "i").test(content));
        if (foundCap) {
            return {
                verdict: "block",
                reason: `AKS safeguard violation: manifest adds dangerous capability: ${foundCap.toUpperCase()}.`,
            };
        }

        return { verdict: "pass" };
    },
};
