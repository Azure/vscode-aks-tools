import * as vscode from "vscode";
import { Phase, createInitialState, loadState, saveState } from "./state";
import { detectIntent } from "./intent";
import { validatePrereqs, executePhase, classifyError } from "./phaseRunner";
import { renderProgress, renderStateSummary, phaseName } from "./progress";
import { reportKickstartTelemetry } from "./telemetry";
import { getAssetContext } from "../../assets";

export async function defaultHandler(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
    if (token.isCancellationRequested) {
        return { metadata: { command: request.command ?? "welcome", cancelled: true } };
    }

    try {
        const extensionContext = getAssetContext();
        if (!extensionContext) {
            stream.markdown("**Error:** Extension context not available. Please reload the extension.");
            return { metadata: { command: request.command ?? "welcome", error: "Extension context not available" } };
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown(
                "## Welcome to AKS Kickstart\n\nI can help you containerize your application and deploy it to Azure Kubernetes Service.",
            );
            stream.button({ command: "aks.kickstart.configureAndStart", title: "Configure & Start" });
            stream.button({ command: "aks.kickstart.useWorkspace", title: "Use current workspace" });
            stream.button({ command: "aks.kickstart.useSample", title: "Use a sample" });
            return { metadata: { command: request.command ?? "welcome" } };
        }

        const workspaceFolder = workspaceFolders[0].uri.fsPath;
        let state = loadState(extensionContext, workspaceFolder) ?? createInitialState(workspaceFolder);
        const intent = detectIntent(request.prompt ?? "", request.command, state);

        reportKickstartTelemetry(
            intent.action === "run" && intent.phase ? `phase-${intent.phase}.invoked` : `${intent.action}.invoked`,
        );

        if (intent.action === "status") {
            stream.markdown(renderProgress(state.currentPhase));
            stream.markdown(renderStateSummary(state));
            reportKickstartTelemetry("status.completed");
            return { metadata: { command: "status" } };
        }

        if (intent.action === "reset") {
            state = createInitialState(workspaceFolder);
            await saveState(extensionContext, workspaceFolder, state);
            stream.markdown("✨ **Starting fresh!**\n\nLet's analyze your project...");
            reportKickstartTelemetry("reset.completed");
            return { metadata: { command: "reset" } };
        }

        if (intent.action === "run" && intent.phase !== undefined) {
            const prereqCheck = validatePrereqs(intent.phase, state);
            if (!prereqCheck.ok) {
                const missing = prereqCheck.missing?.join(", ") ?? "unknown prerequisites";
                const suggestedPhase =
                    prereqCheck.suggestedPhase !== undefined ? phaseName(prereqCheck.suggestedPhase) : "previous phase";
                stream.markdown(
                    `**Missing prerequisites for ${phaseName(intent.phase)}:**\n\n${missing}\n\n**Suggested:** Complete the ${suggestedPhase} first.`,
                );
                reportKickstartTelemetry(`phase-${intent.phase}.prereq-failed`);
                return { metadata: { command: `phase-${intent.phase}`, error: `Missing prerequisites: ${missing}` } };
            }

            stream.progress(`Running ${phaseName(intent.phase)} phase...`);
            const result = await executePhase(intent.phase, state, stream, token);

            if (!result.ok) {
                const classification = classifyError(result.error);
                stream.markdown(`**${classification.title}**\n\n${classification.detail}`);
                if (classification.retryable) {
                    stream.markdown("You can retry this phase by saying: retry");
                }
                state.lastError = {
                    phase: intent.phase,
                    message: result.error ?? "Unknown error",
                    retryable: result.retryable ?? false,
                };
                await saveState(extensionContext, workspaceFolder, state);
                reportKickstartTelemetry(`phase-${intent.phase}.failed`);
                return { metadata: { command: `phase-${intent.phase}`, error: result.error } };
            }

            if (result.analysis) {
                state.analysis = result.analysis;
            }
            if (result.config) {
                state.config = result.config;
            }
            if (result.artifacts) {
                state.artifacts = result.artifacts;
            }
            if (result.image) {
                state.image = result.image;
            }
            if (result.deployment) {
                state.deployment = result.deployment;
            }
            if (result.verification) {
                state.verification = result.verification;
            }

            if (intent.phase < Phase.COMPLETE) {
                state.currentPhase = intent.phase + 1;
            }
            state.lastError = undefined;
            await saveState(extensionContext, workspaceFolder, state);

            stream.markdown(renderProgress(state.currentPhase));

            if (state.currentPhase <= Phase.VERIFY) {
                const nextPhase = phaseName(state.currentPhase);
                stream.markdown(`\n✅ **${phaseName(intent.phase)} complete!**\n\nReady for the next step?`);
                stream.button({ command: `aks.kickstart.${nextPhase.toLowerCase()}`, title: `Next: ${nextPhase}` });
            } else if (state.currentPhase === Phase.COMPLETE) {
                stream.markdown("\n🎉 **All done!** Your application is ready on AKS.");
            }

            reportKickstartTelemetry(`phase-${intent.phase}.completed`);
            return { metadata: { command: `phase-${intent.phase}` } };
        }

        stream.markdown(
            "## Welcome to AKS Kickstart\n\nI can help you containerize your application and deploy it to Azure Kubernetes Service.",
        );
        stream.button({ command: "aks.kickstart.configureAndStart", title: "Configure & Start" });
        stream.button({ command: "aks.kickstart.useWorkspace", title: "Use current workspace" });
        stream.button({ command: "aks.kickstart.useSample", title: "Use a sample" });
        reportKickstartTelemetry("welcome.completed");
        return { metadata: { command: "welcome" } };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        stream.markdown(`**Error:** ${message}`);
        reportKickstartTelemetry("handler.error");
        return { metadata: { command: request.command ?? "welcome", error: message } };
    }
}
