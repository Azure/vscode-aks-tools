import type { GuardrailContribution, GuardrailInput, GuardrailResult, GuardrailStage } from "./types";

export interface RunGuardrailsResult {
    blocked: boolean;
    mutatedInput: GuardrailInput;
}

function matchGlob(pattern: string, value: string): boolean {
    if (pattern === "*") return true;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexStr = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
    return new RegExp(regexStr).test(value);
}

function matchesAnyGlob(patterns: string[], value: string): boolean {
    return patterns.some((p) => matchGlob(p, value));
}

export function applyRedact(input: GuardrailInput, result: GuardrailResult): void {
    if (result.verdict !== "redact") return;

    switch (input.stage) {
        case "input":
            if (typeof result.redacted !== "string") {
                throw new Error("Guardrail redact on input stage: redacted value must be a string");
            }
            input.userMessage = result.redacted;
            break;

        case "output":
            if (typeof result.redacted !== "string") {
                throw new Error("Guardrail redact on output stage: redacted value must be a string");
            }
            input.proposedOutput = result.redacted;
            break;

        case "tool":
            if (result.redactedArgs !== undefined) {
                input.toolArgs = result.redactedArgs;
            } else if (result.redacted !== undefined) {
                input.toolArgs = result.redacted as Record<string, unknown>;
            }
            break;
    }
}

// Fail-closed: any throw -> block. Core/ guardrails run first, non-overridable.
// Dual-eval chaining: each guardrail sees the (possibly already redacted) payload.
export async function runGuardrails(
    stage: GuardrailStage,
    input: GuardrailInput,
    contributions: GuardrailContribution[],
    agentName: string,
): Promise<RunGuardrailsResult> {
    const applicable = contributions.filter((g) => g.stages.includes(stage) && matchesAnyGlob(g.appliesTo, agentName));

    const coreGuardrails = applicable.filter((g) => g.id.startsWith("core/"));
    const otherGuardrails = applicable.filter((g) => !g.id.startsWith("core/"));
    const ordered = [...coreGuardrails, ...otherGuardrails];

    const current: GuardrailInput = { ...input };

    for (const guardrail of ordered) {
        let result: GuardrailResult;

        try {
            result = await guardrail.evaluate(current);
        } catch {
            return { blocked: true, mutatedInput: current };
        }

        if (result.verdict === "block") {
            return { blocked: true, mutatedInput: current };
        }

        if (result.verdict === "redact") {
            try {
                applyRedact(current, result);
            } catch {
                return { blocked: true, mutatedInput: current };
            }
        }
    }

    Object.assign(input, current);
    return { blocked: false, mutatedInput: input };
}
