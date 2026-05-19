import type { GuardrailContribution, GuardrailInput, GuardrailResult } from "../types";

function shannonEntropy(s: string): number {
    const freq = new Map<string, number>();
    for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
    let entropy = 0;
    for (const count of freq.values()) {
        const p = count / s.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    {
        name: "generic-api-key",
        pattern: /(?:api[_-]?key|secret|token|password)\s*[=:]\s*['"]?[A-Za-z0-9+/]{20,}['"]?/i,
    },
    { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/ },
    { name: "github-pat", pattern: /ghp_[A-Za-z0-9]{36}/ },
    { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: "azure-sas", pattern: /sv=\d{4}-\d{2}-\d{2}&s[ps]=/ },
    { name: "connection-string", pattern: /(?:Password|AccountKey)=[^;]{8,}/i },
];

const MIN_ENTROPY_TOKEN_LENGTH = 20;
const ENTROPY_THRESHOLD = 4.5;

function containsHighEntropyToken(text: string): boolean {
    const tokens = text.split(/[\s"',;=:{}[\]()<>]+/);
    for (const token of tokens) {
        if (
            token.length >= MIN_ENTROPY_TOKEN_LENGTH &&
            /^[A-Za-z0-9+/=_-]+$/.test(token) &&
            shannonEntropy(token) >= ENTROPY_THRESHOLD
        ) {
            return true;
        }
    }
    return false;
}

function extractText(payload: unknown): string {
    if (typeof payload === "string") return payload;
    try {
        return JSON.stringify(payload);
    } catch {
        return "";
    }
}

export const noSecretsInArtifactsGuardrail: GuardrailContribution = {
    id: "core/no-secrets-in-artifacts",
    appliesTo: ["*"],
    stages: ["tool"],
    async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
        if (
            input.toolName !== "write_file" &&
            input.toolName !== "core/write_file" &&
            input.toolName !== "core.write_file"
        ) {
            return { verdict: "pass" };
        }

        const text = extractText(input.toolArgs);

        for (const { name, pattern } of SECRET_PATTERNS) {
            if (pattern.test(text)) {
                return {
                    verdict: "block",
                    reason: `File write blocked: possible ${name} detected in artifact content.`,
                };
            }
        }

        if (containsHighEntropyToken(text)) {
            return {
                verdict: "block",
                reason: "File write blocked: high-entropy token detected in artifact content.",
            };
        }

        return { verdict: "pass" };
    },
};
