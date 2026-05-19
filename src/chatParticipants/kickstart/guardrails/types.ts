export type GuardrailStage = "input" | "output" | "tool";

export interface GuardrailInput {
    stage: GuardrailStage;
    /** User message text (populated for input stage). */
    userMessage?: string;
    /** LLM-proposed output text (populated for output stage). */
    proposedOutput?: string;
    /** Tool name being called (populated for tool stage). */
    toolName?: string;
    /** Tool call arguments (populated for tool stage). */
    toolArgs?: Record<string, unknown>;
}

export interface GuardrailResult {
    verdict: "pass" | "block" | "redact";
    /** Human-readable reason (server-side only — never shown to users). */
    reason?: string;
    /** Replacement payload for redact verdict (replaces stage-appropriate field). */
    redacted?: unknown;
    /** Structured tool-arg replacement for tool-stage redact. */
    redactedArgs?: Record<string, unknown>;
}

/** Guardrails prefixed "core/" run first; their block verdicts are non-overridable. */
export interface GuardrailContribution {
    /** Fully-qualified id, e.g. "core/no-credential-leak" or "aks/no-privileged-containers". */
    id: string;
    /** Agent-name globs this guardrail applies to. Use ["*"] for all agents. */
    appliesTo: string[];
    /** Which pipeline stages this guardrail runs on. */
    stages: GuardrailStage[];
    /** Evaluate the guardrail against the given input. Must not throw — throws are treated as blocks. */
    evaluate(input: GuardrailInput): Promise<GuardrailResult>;
}
