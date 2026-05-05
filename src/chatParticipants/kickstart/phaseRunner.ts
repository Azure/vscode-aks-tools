import * as vscode from "vscode";
import { Phase, KickstartState } from "./state";

/**
 * Result of executing a phase
 */
export interface PhaseResult {
    ok: boolean;
    error?: string;
    retryable?: boolean;
}

/**
 * Result of validating prerequisites for a phase
 */
export interface PrereqResult {
    ok: boolean;
    missing?: string[];
    suggestedPhase?: Phase;
}

/**
 * User-friendly classification of an error
 */
export interface ErrorClassification {
    title: string;
    detail: string;
    retryable: boolean;
    fixCommand?: { id: string; label: string };
}

/**
 * Validates that the required data from prior phases exists before executing a new phase.
 *
 * Phase requirements:
 * - ANALYZE: no prerequisites (always valid)
 * - CONFIGURE: requires state.analysis from ANALYZE
 * - PREPARE: requires state.config from CONFIGURE
 * - BUILD: requires state.artifacts?.savedToDisk === true from PREPARE
 * - DEPLOY: requires state.image from BUILD
 * - VERIFY: requires state.deployment from DEPLOY
 * - COMPLETE: requires state.verification from VERIFY
 *
 * @param phase The phase to validate
 * @param state The current kickstart state
 * @returns PrereqResult indicating if prerequisites are met
 */
export function validatePrereqs(phase: Phase, state: KickstartState): PrereqResult {
    // ANALYZE has no prerequisites
    if (phase === Phase.ANALYZE) {
        return { ok: true };
    }

    // CONFIGURE requires ANALYZE to have completed
    if (phase === Phase.CONFIGURE) {
        if (!state.analysis) {
            return {
                ok: false,
                missing: ["Project analysis data"],
                suggestedPhase: Phase.ANALYZE,
            };
        }
        return { ok: true };
    }

    // PREPARE requires CONFIGURE to have completed
    if (phase === Phase.PREPARE) {
        if (!state.config) {
            return {
                ok: false,
                missing: ["Cluster and registry configuration"],
                suggestedPhase: Phase.CONFIGURE,
            };
        }
        return { ok: true };
    }

    // BUILD requires PREPARE to have completed and artifacts saved
    if (phase === Phase.BUILD) {
        const missing: string[] = [];
        if (!state.artifacts || !state.artifacts.savedToDisk) {
            missing.push("Generated artifacts saved to disk");
        }
        if (missing.length > 0) {
            return {
                ok: false,
                missing,
                suggestedPhase: Phase.PREPARE,
            };
        }
        return { ok: true };
    }

    // DEPLOY requires BUILD to have completed
    if (phase === Phase.DEPLOY) {
        if (!state.image) {
            return {
                ok: false,
                missing: ["Built and pushed container image"],
                suggestedPhase: Phase.BUILD,
            };
        }
        return { ok: true };
    }

    // VERIFY requires DEPLOY to have completed
    if (phase === Phase.VERIFY) {
        if (!state.deployment) {
            return {
                ok: false,
                missing: ["Deployed manifests and tracking data"],
                suggestedPhase: Phase.DEPLOY,
            };
        }
        return { ok: true };
    }

    // COMPLETE requires VERIFY to have completed
    if (phase === Phase.COMPLETE) {
        if (!state.verification) {
            return {
                ok: false,
                missing: ["Verification results"],
                suggestedPhase: Phase.VERIFY,
            };
        }
        return { ok: true };
    }

    return { ok: true };
}

/**
 * Classifies an error into a user-friendly category with suggested fixes.
 *
 * Recognizes patterns for:
 * - Authentication errors (suggest `az login`)
 * - Permission errors (non-retryable)
 * - Network errors (retryable)
 * - Validation errors (non-retryable)
 * - Default/unknown errors (retryable)
 *
 * @param error The error to classify (Error, string, or unknown)
 * @returns ErrorClassification with title, detail, retryable flag, and optional fix command
 */
export function classifyError(error: unknown): ErrorClassification {
    // Extract error message from Error, string, or unknown
    let message = "";
    if (error instanceof Error) {
        message = error.message;
    } else if (typeof error === "string") {
        message = error;
    } else if (error && typeof error === "object" && "message" in error) {
        message = String((error as Record<string, unknown>).message);
    } else {
        message = String(error);
    }

    const lowerMessage = message.toLowerCase();

    // Authentication errors
    if (
        lowerMessage.includes("authentication") ||
        lowerMessage.includes("login") ||
        lowerMessage.includes("unauthorized") ||
        lowerMessage.includes("unauthenticated")
    ) {
        return {
            title: "Authentication Required",
            detail: "You need to authenticate with Azure. Run `az login` to get started.",
            retryable: true,
            fixCommand: { id: "az.login", label: "Run az login" },
        };
    }

    // Permission/access errors
    if (
        lowerMessage.includes("permission") ||
        lowerMessage.includes("forbidden") ||
        lowerMessage.includes("access denied") ||
        lowerMessage.includes("not authorized")
    ) {
        return {
            title: "Insufficient Permissions",
            detail: "You don't have the required permissions. Check your Azure RBAC roles and try again.",
            retryable: false,
        };
    }

    // Network errors
    if (
        lowerMessage.includes("network") ||
        lowerMessage.includes("timeout") ||
        lowerMessage.includes("econnrefused") ||
        lowerMessage.includes("enotfound") ||
        lowerMessage.includes("connection") ||
        lowerMessage.includes("unreachable")
    ) {
        return {
            title: "Network Error",
            detail: "A network error occurred. Check your connection and try again.",
            retryable: true,
        };
    }

    // Validation errors
    if (
        lowerMessage.includes("invalid") ||
        lowerMessage.includes("required") ||
        lowerMessage.includes("missing") ||
        lowerMessage.includes("validation")
    ) {
        return {
            title: "Validation Error",
            detail: `Invalid configuration: ${message}`,
            retryable: false,
        };
    }

    // Default/unknown error
    return {
        title: "An Error Occurred",
        detail: message || "An unknown error occurred. Please check the logs for details.",
        retryable: true,
    };
}

/**
 * Executes a phase of the kickstart workflow.
 *
 * **Note:** This is currently a stub implementation. Phase execution logic will be
 * implemented in phases T5-T10. Each phase handler will be added to the switch statement.
 *
 * @param phase The phase to execute
 * @param state The current kickstart state
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @returns PhaseResult indicating success/failure and whether retry is possible
 */
export async function executePhase(
    phase: Phase,
    _state: KickstartState,
    _stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken,
): Promise<PhaseResult> {
    try {
        // TODO: Phase implementations will be added in T5-T10
        // Each phase will have its own implementation with specific logic
        switch (phase) {
            case Phase.ANALYZE:
                return { ok: false, error: "Phase execution not yet implemented" };

            case Phase.CONFIGURE:
                return { ok: false, error: "Phase execution not yet implemented" };

            case Phase.PREPARE:
                return { ok: false, error: "Phase execution not yet implemented" };

            case Phase.BUILD:
                return { ok: false, error: "Phase execution not yet implemented" };

            case Phase.DEPLOY:
                return { ok: false, error: "Phase execution not yet implemented" };

            case Phase.VERIFY:
                return { ok: false, error: "Phase execution not yet implemented" };

            case Phase.COMPLETE:
                return { ok: false, error: "Phase execution not yet implemented" };

            default:
                return { ok: false, error: `Unknown phase: ${phase}` };
        }
    } catch (err) {
        const classification = classifyError(err);
        return {
            ok: false,
            error: classification.detail,
            retryable: classification.retryable,
        };
    }
}
