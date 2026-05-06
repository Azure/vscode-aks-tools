import { Phase, KickstartState } from "./state";

/**
 * Intent represents the user's action request parsed from natural language
 */
export interface Intent {
    phase?: Phase;
    action: "run" | "status" | "reset" | "skip" | "create";
}

/**
 * Detects the user's intent from their prompt and command
 *
 * Priority:
 * 1. Slash commands (highest priority)
 * 2. Keyword matching (case-insensitive)
 * 3. Default behavior (continue from current phase)
 *
 * @param prompt The user's natural language prompt
 * @param command Optional slash command (e.g., "/start", "/sample")
 * @param state The current kickstart state
 * @returns An Intent object representing the parsed action
 */
export function detectIntent(prompt: string, command: string | undefined, state: KickstartState): Intent {
    // Priority 1: Slash commands
    if (command) {
        if (command === "/start") {
            // Start from beginning if no prior state or already complete
            if (state.currentPhase === Phase.COMPLETE) {
                return { action: "run", phase: Phase.ANALYZE };
            }
            // Resume from current phase if in progress
            return { action: "run", phase: state.currentPhase };
        }
        if (command === "/sample") {
            // Sample command triggers analysis phase (will use sample repo)
            return { action: "run", phase: Phase.ANALYZE };
        }
    }

    // Priority 2: Keyword matching (case-insensitive)
    const lowerPrompt = prompt.toLowerCase();

    // Create cluster keywords
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

    // Status/progress keywords
    if (lowerPrompt.includes("status") || lowerPrompt.includes("where am i") || lowerPrompt.includes("progress")) {
        return { action: "status" };
    }

    // Reset/restart keywords
    if (lowerPrompt.includes("start over") || lowerPrompt.includes("reset") || lowerPrompt.includes("restart")) {
        return { action: "reset" };
    }

    // Phase-specific keywords
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

    // Priority 3: Default - continue from current phase
    return { action: "run", phase: state.currentPhase };
}
