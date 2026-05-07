import * as vscode from "vscode";
import {
    Phase,
    KickstartState,
    AnalysisData,
    ConfigData,
    ArtifactsData,
    ImageData,
    DeploymentData,
    VerificationData,
} from "./state";
import { analyzePhase } from "./phases/analyze";
import { configurePhase } from "./phases/configure";
import { preparePhase } from "./phases/prepare";
import { buildPhase } from "./phases/build";
import { deployPhase } from "./phases/deploy";
import { verifyPhase } from "./phases/verify";

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
    let message: string;
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
 * Dispatches to the appropriate phase handler based on the phase type.
 * Each phase has specific entry and exit validation, updates the state,
 * and returns PhaseResult with optional phase-specific data.
 *
 * @param phase The phase to execute
 * @param state The current kickstart state
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @param request The chat request object with model and toolInvocationToken
 * @returns PhaseResult indicating success/failure and whether retry is possible
 */
export async function executePhase(
    phase: Phase,
    state: KickstartState,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    request: vscode.ChatRequest,
): Promise<
    PhaseResult & {
        analysis?: AnalysisData;
        config?: ConfigData;
        artifacts?: ArtifactsData;
        image?: ImageData;
        deployment?: DeploymentData;
        verification?: VerificationData;
    }
> {
    try {
        const workspaceFolder = vscode.Uri.file(state.projectPath ?? state.workspaceFolder);

        switch (phase) {
            case Phase.ANALYZE:
                return await analyzePhase(workspaceFolder, stream, token, request);

            case Phase.CONFIGURE:
                return await configurePhase(stream, token);

            case Phase.PREPARE:
                if (!state.analysis || !state.config) {
                    return {
                        ok: false,
                        error: "Missing prerequisites for PREPARE phase.",
                        retryable: false,
                    };
                }
                return await preparePhase(workspaceFolder, state.analysis, state.config, stream, token);

            case Phase.BUILD:
                if (!state.artifacts || !state.config) {
                    return {
                        ok: false,
                        error: "Missing prerequisites for BUILD phase.",
                        retryable: false,
                    };
                }
                return await buildPhase(workspaceFolder, state.artifacts, state.config, stream, token, request);

            case Phase.DEPLOY:
                if (!state.artifacts || !state.config || !state.image) {
                    return {
                        ok: false,
                        error: "Missing prerequisites for DEPLOY phase.",
                        retryable: false,
                    };
                }
                return await deployPhase(
                    workspaceFolder,
                    state.artifacts,
                    state.config,
                    state.image,
                    stream,
                    token,
                    request,
                );

            case Phase.VERIFY:
                if (!state.deployment || !state.config) {
                    return {
                        ok: false,
                        error: "Missing prerequisites for VERIFY phase.",
                        retryable: false,
                    };
                }
                return await verifyPhase(workspaceFolder, state.deployment, state.config, stream, token);

            case Phase.COMPLETE:
                return {
                    ok: false,
                    error: "Phase execution not yet implemented",
                    retryable: false,
                };

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
