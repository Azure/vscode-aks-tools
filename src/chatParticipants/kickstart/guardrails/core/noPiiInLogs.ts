import type { GuardrailContribution, GuardrailInput, GuardrailResult } from "../types";

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
    { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[REDACTED-EMAIL]" },
    { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[REDACTED-SSN]" },
    { name: "phone", pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, replacement: "[REDACTED-PHONE]" },
];

function redactPii(text: string): { redacted: string; found: boolean } {
    let result = text;
    let found = false;
    for (const { pattern, replacement } of PII_PATTERNS) {
        const next = result.replace(pattern, replacement);
        if (next !== result) found = true;
        result = next;
    }
    return { redacted: result, found };
}

function extractText(payload: unknown): string {
    if (typeof payload === "string") return payload;
    try {
        return JSON.stringify(payload);
    } catch {
        return "";
    }
}

export const noPiiInLogsGuardrail: GuardrailContribution = {
    id: "core/no-pii-in-logs",
    appliesTo: ["*"],
    stages: ["output", "tool"],
    async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
        let text: string;
        if (input.stage === "output") {
            text = input.proposedOutput ?? "";
        } else if (input.stage === "tool") {
            text = extractText(input.toolArgs);
        } else {
            return { verdict: "pass" };
        }

        const { redacted, found } = redactPii(text);
        if (!found) return { verdict: "pass" };

        if (input.stage === "output") {
            return { verdict: "redact", redacted, reason: "PII detected in output." };
        }

        try {
            const newArgs = JSON.parse(redacted) as Record<string, unknown>;
            return { verdict: "redact", redactedArgs: newArgs, reason: "PII detected in tool args." };
        } catch {
            return { verdict: "block", reason: "PII detected in tool args — could not safely redact." };
        }
    },
};
