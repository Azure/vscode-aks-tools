import type { GuardrailContribution, GuardrailInput, GuardrailResult } from "../types";

const CREDENTIAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    { name: "azure-access-token", pattern: /Bearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i },
    { name: "jwt-token", pattern: /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/ },
    { name: "github-pat-ghp", pattern: /\bghp_[A-Za-z0-9]{30,}\b/ },
    { name: "github-pat-ghs", pattern: /\bghs_[A-Za-z0-9]{30,}\b/ },
    { name: "github-pat-fine", pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
    { name: "azure-sas-token", pattern: /sv=\d{4}-\d{2}-\d{2}[^"'\s]*&sig=[A-Za-z0-9%+/=]{20,}/i },
    { name: "azure-connection-string", pattern: /(?:AccountKey|SharedAccessSignature)=[A-Za-z0-9+/=]{20,}/i },
    { name: "connection-string-password", pattern: /(?:Password|Pwd)=[^;]{8,}/i },
    { name: "ssh-private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

function containsCredential(text: string): string | null {
    for (const { name, pattern } of CREDENTIAL_PATTERNS) {
        if (pattern.test(text)) return name;
    }
    return null;
}

function extractText(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}

export const noCredentialLeakGuardrail: GuardrailContribution = {
    id: "core/no-credential-leak",
    appliesTo: ["*"],
    stages: ["input", "output", "tool"],
    async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
        let text: string;

        switch (input.stage) {
            case "input":
                text = input.userMessage ?? "";
                break;
            case "output":
                text = input.proposedOutput ?? "";
                break;
            case "tool":
                text = extractText(input.toolArgs);
                break;
        }

        const credentialType = containsCredential(text);
        if (credentialType) {
            return {
                verdict: "block",
                reason: `Credential detected in ${input.stage} payload (${credentialType}).`,
            };
        }

        return { verdict: "pass" };
    },
};
