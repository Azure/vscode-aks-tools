import { Phase, KickstartState } from "./state";
import type { LMClient } from "../../commands/aksContainerAssist/lmClient";
import type * as vscode from "vscode";
import { getDefaultGuardrails } from "./guardrails";

export interface Intent {
    phase?: Phase;
    action: "run" | "status" | "reset" | "skip" | "create" | "handoff";
}

/**
 * Fast-path intent detection. Returns undefined if no keyword matches
 * (signals "ambiguous, consider LLM fallback").
 */
export function detectIntentFast(
    prompt: string,
    command: string | undefined,
    state: KickstartState,
): Intent | undefined {
    if (command) {
        if (command === "/start") {
            if (state.currentPhase === Phase.COMPLETE) {
                return { action: "run", phase: Phase.ANALYZE };
            }
            return { action: "run", phase: state.currentPhase };
        }
        if (command === "/sample") {
            return { action: "run", phase: Phase.ANALYZE };
        }
    }

    const lowerPrompt = prompt.toLowerCase();

    if (
        lowerPrompt.includes("create cluster") ||
        lowerPrompt.includes("create a cluster") ||
        lowerPrompt.includes("new cluster") ||
        lowerPrompt.includes("create aks") ||
        lowerPrompt.includes("provision cluster") ||
        lowerPrompt.includes("i don't have a cluster") ||
        lowerPrompt.includes("no cluster")
    ) {
        return { action: "create" };
    }

    if (
        lowerPrompt.includes("pull request") ||
        lowerPrompt.includes("create pr") ||
        lowerPrompt.includes("open pr") ||
        lowerPrompt.includes("handoff") ||
        lowerPrompt.includes("hand off")
    ) {
        return { action: "handoff" };
    }

    if (lowerPrompt.includes("status") || lowerPrompt.includes("where am i") || lowerPrompt.includes("progress")) {
        return { action: "status" };
    }

    if (lowerPrompt.includes("start over") || lowerPrompt.includes("reset") || lowerPrompt.includes("restart")) {
        return { action: "reset" };
    }

    if (lowerPrompt.includes("resume") || lowerPrompt.includes("continue") || lowerPrompt.includes("retry")) {
        return { action: "run", phase: state.currentPhase };
    }

    if (lowerPrompt.includes("analyze") || lowerPrompt.includes("scan")) {
        return { action: "run", phase: Phase.ANALYZE };
    }

    if (lowerPrompt.includes("configure") || lowerPrompt.includes("select") || lowerPrompt.includes("choose cluster")) {
        return { action: "run", phase: Phase.CONFIGURE };
    }

    if (
        lowerPrompt.includes("prepare") ||
        lowerPrompt.includes("generate") ||
        lowerPrompt.includes("dockerfile") ||
        lowerPrompt.includes("manifest")
    ) {
        return { action: "run", phase: Phase.PREPARE };
    }

    if (lowerPrompt.includes("build") || lowerPrompt.includes("push")) {
        return { action: "run", phase: Phase.BUILD };
    }

    if (lowerPrompt.includes("deploy") || lowerPrompt.includes("ship") || lowerPrompt.includes("apply")) {
        return { action: "run", phase: Phase.DEPLOY };
    }

    if (lowerPrompt.includes("verify") || lowerPrompt.includes("check") || lowerPrompt.includes("health")) {
        return { action: "run", phase: Phase.VERIFY };
    }

    return undefined;
}

const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `You classify user intents for an AKS Kickstart workflow that helps deploy applications to Azure Kubernetes Service. The workflow has 6 phases:
- ANALYZE (0): inspect project, detect language/framework
- CONFIGURE (1): select Azure cluster and container registry
- PREPARE (2): generate Dockerfile and Kubernetes manifests
- BUILD (3): build and push container image
- DEPLOY (4): apply manifests to the cluster
- VERIFY (5): check pod health and service endpoint

Given the user's message and current phase, choose exactly ONE intent:
- "run" with a phase number 0-5: execute that phase
- "status": show current progress
- "reset": start over
- "create": create a new AKS cluster
- "handoff": create a GitHub pull request with the generated artifacts

Respond with ONLY a JSON object on a single line, no markdown, no explanation. Examples:
{"action":"run","phase":3}
{"action":"status"}
{"action":"reset"}
{"action":"create"}`;

interface ParsedIntent {
    action: string;
    phase?: number;
}

function parseIntentJson(text: string, state: KickstartState): Intent | undefined {
    const trimmed = text.trim();

    let jsonText = trimmed;
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
    } else {
        const braceMatch = trimmed.match(/\{[\s\S]*\}/);
        if (braceMatch) jsonText = braceMatch[0];
    }

    let parsed: ParsedIntent;
    try {
        parsed = JSON.parse(jsonText) as ParsedIntent;
    } catch {
        return undefined;
    }

    const validActions = ["run", "status", "reset", "skip", "create", "handoff"] as const;
    if (!validActions.includes(parsed.action as (typeof validActions)[number])) {
        return undefined;
    }

    if (parsed.action === "run") {
        const phase = typeof parsed.phase === "number" ? parsed.phase : state.currentPhase;
        if (phase < Phase.ANALYZE || phase > Phase.VERIFY) {
            return { action: "run", phase: state.currentPhase };
        }
        return { action: "run", phase: phase as Phase };
    }

    return { action: parsed.action as Intent["action"] };
}

export async function classifyIntentWithLM(
    prompt: string,
    state: KickstartState,
    lmClient: LMClient,
    token?: vscode.CancellationToken,
): Promise<Intent | undefined> {
    const userPrompt = `Current phase: ${Phase[state.currentPhase]} (${state.currentPhase})
User message: ${prompt}`;

    const result = await lmClient.sendRequest(INTENT_CLASSIFICATION_SYSTEM_PROMPT, userPrompt, token, {
        guardrails: getDefaultGuardrails(),
        agentName: "kickstart-intent",
    });

    if (!result.succeeded) return undefined;

    return parseIntentJson(result.result, state);
}

/**
 * Combined intent detection: keyword fast-path, then LLM fallback, then default.
 */
export async function detectIntent(
    prompt: string,
    command: string | undefined,
    state: KickstartState,
    options?: { lmClient?: LMClient; token?: vscode.CancellationToken },
): Promise<{ intent: Intent; source: "keyword" | "llm" | "default" }> {
    const fast = detectIntentFast(prompt, command, state);
    if (fast) return { intent: fast, source: "keyword" };

    if (options?.lmClient && prompt.trim().length > 0) {
        const classified = await classifyIntentWithLM(prompt, state, options.lmClient, options.token);
        if (classified) return { intent: classified, source: "llm" };
    }

    return { intent: { action: "run", phase: state.currentPhase }, source: "default" };
}
