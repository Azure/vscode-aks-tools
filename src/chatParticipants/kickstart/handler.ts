import * as vscode from "vscode";
import { Phase, createInitialState, loadState, saveState } from "./state";
import { KICKSTART_PARTICIPANT_ID } from "./config";
import { detectIntent } from "./intent";
import { validatePrereqs, executePhase, classifyError } from "./phaseRunner";
import { renderProgress, renderStateSummary, phaseName } from "./progress";
import { reportKickstartTelemetry } from "./telemetry";
import { getAssetContext } from "../../assets";
import { runGuardrails, getDefaultGuardrails } from "./guardrails";
import { LMClient } from "../../commands/aksContainerAssist/lmClient";

let sharedLmClient: LMClient | undefined;

/**
 * Returns true if this is the first kickstart turn in this chat thread
 * (i.e. no prior kickstart response exists in history).
 */
function isNewThread(context: vscode.ChatContext): boolean {
    return !context.history.some(
        (turn) => turn instanceof vscode.ChatResponseTurn && turn.participant === KICKSTART_PARTICIPANT_ID,
    );
}

export async function defaultHandler(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
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
                "## 🚀 AKS Kickstart\n\n" +
                    "I'll help you containerize and deploy your application to Azure Kubernetes Service (AKS) in minutes.\n\n" +
                    "**Here's what I do:**\n" +
                    "1. 🔍 **Analyze** your project (language, framework, entry point)\n" +
                    "2. ⚙️ **Configure** your Azure target (AKS cluster + container registry)\n" +
                    "3. 📦 **Prepare** deployment artifacts (Dockerfile + K8s manifests)\n" +
                    "4. 🔨 **Build** and push your container image\n" +
                    "5. 🚀 **Deploy** to your AKS cluster\n" +
                    "6. ✅ **Verify** everything is running\n\n" +
                    "**Choose how to get started:**",
            );
            stream.button({ command: "aks.kickstart.useSample", title: "📦 Use sample repo" });
            stream.button({ command: "aks.kickstart.useWorkspace", title: "📂 Use existing repo" });
            stream.button({ command: "aks.kickstart.createNew", title: "✨ Create something new" });
            return { metadata: { command: request.command ?? "welcome" } };
        }

        const workspaceFolder = workspaceFolders[0].uri.fsPath;
        const pendingSamplePath = extensionContext.globalState.get<string>("kickstart.pendingSamplePath");
        if (pendingSamplePath) {
            extensionContext.globalState.update("kickstart.pendingSamplePath", undefined);
            const state = createInitialState(workspaceFolder);
            state.projectPath = pendingSamplePath;
            state.projectSource = "sample";
            await saveState(extensionContext, workspaceFolder, state);
        }

        const existingState = loadState(extensionContext, workspaceFolder);
        let state = existingState ?? createInitialState(workspaceFolder);
        const hasExistingProgress =
            !!existingState && (existingState.currentPhase > Phase.ANALYZE || !!existingState.analysis);

        const prompt = request.prompt ?? "";
        const isEmptyPrompt = prompt.trim().length === 0 && !request.command;

        if (prompt.trim().length > 0) {
            const guardrails = getDefaultGuardrails();
            const inputCheck = await runGuardrails(
                "input",
                { stage: "input", userMessage: prompt },
                guardrails,
                "kickstart",
            );
            if (inputCheck.blocked) {
                stream.markdown(
                    "**Blocked:** Your message was flagged by a safety check and cannot be processed. " +
                        "Please remove any credentials, secrets, or sensitive data and try again.",
                );
                reportKickstartTelemetry("guardrail.input-blocked");
                return { metadata: { command: "guardrail-blocked" } };
            }
        }

        // In a new chat thread, always pause and surface any existing workspace
        // session before acting — regardless of what the user typed.
        if (isNewThread(context) && hasExistingProgress) {
            stream.markdown("## 🚀 AKS Kickstart\n\n");
            stream.markdown(renderProgress(state.currentPhase));
            stream.markdown("\n\n");
            stream.markdown(renderStateSummary(state));
            stream.markdown("\n\n**You have an existing session for this workspace.** What would you like to do?\n");
            stream.button({ command: "aks.kickstart.resume", title: `▶️ Resume (${phaseName(state.currentPhase)})` });
            stream.button({ command: "aks.kickstart.newSession", title: "✨ Start new session" });
            reportKickstartTelemetry("resume-prompt.shown");
            return { metadata: { command: "resume-prompt" } };
        }

        if (isEmptyPrompt && !hasExistingProgress) {
            stream.markdown(
                "## 🚀 AKS Kickstart\n\n" +
                    "I'll help you containerize and deploy your application to Azure Kubernetes Service (AKS) in minutes.\n\n" +
                    "**Here's what I do:**\n" +
                    "1. 🔍 **Analyze** your project (language, framework, entry point)\n" +
                    "2. ⚙️ **Configure** your Azure target (AKS cluster + container registry)\n" +
                    "3. 📦 **Prepare** deployment artifacts (Dockerfile + K8s manifests)\n" +
                    "4. 🔨 **Build** and push your container image\n" +
                    "5. 🚀 **Deploy** to your AKS cluster\n" +
                    "6. ✅ **Verify** everything is running\n\n" +
                    "**Choose how to get started:**",
            );
            stream.button({ command: "aks.kickstart.useSample", title: "📦 Use sample repo" });
            stream.button({ command: "aks.kickstart.useWorkspace", title: "📂 Use existing repo" });
            stream.button({ command: "aks.kickstart.createNew", title: "✨ Create something new" });
            reportKickstartTelemetry("welcome.completed");
            return { metadata: { command: "welcome" } };
        }

        if (!sharedLmClient) {
            sharedLmClient = new LMClient();
        }
        const lmClient = sharedLmClient;
        await lmClient.ensureModel();
        const { intent, source: intentSource } = await detectIntent(prompt, request.command, state, {
            lmClient,
            token,
        });

        reportKickstartTelemetry(
            intent.action === "run" && intent.phase ? `phase-${intent.phase}.invoked` : `${intent.action}.invoked`,
            { intentSource },
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

        if (intent.action === "create") {
            stream.markdown(
                "## Create an AKS Cluster\n\n" +
                    "I can help you create a new AKS cluster. You have two options:\n\n" +
                    "**AKS Automatic** (recommended for kickstart) — Azure manages node pools, scaling, and upgrades automatically. " +
                    "Great for getting started quickly.\n\n" +
                    "**AKS Standard** — Full control over node pools, scaling policies, and configuration.\n\n",
            );
            stream.button({ command: "aks.createCluster", title: "🆕 Create cluster (guided wizard)" });
            stream.button({ command: "aks.aksCreateClusterFromCopilot", title: "🤖 Create with Copilot" });
            stream.markdown(
                "\n\nAfter creating your cluster, come back and say **configure** to continue the kickstart flow.",
            );
            reportKickstartTelemetry("create-cluster.offered");
            return { metadata: { command: "create" } };
        }

        if (intent.action === "handoff") {
            const files = state.artifacts?.stagedFiles?.map((f) => f.filename) ?? [];
            if (files.length === 0) {
                stream.markdown(
                    "**No artifacts to commit.** Run `@kickstart prepare` first to generate Dockerfile and Kubernetes manifests, then save them to your project.",
                );
                reportKickstartTelemetry("handoff.no-artifacts");
                return { metadata: { command: "handoff", error: "no artifacts" } };
            }

            if (!state.artifacts?.savedToDisk) {
                stream.markdown(
                    "**Artifacts not saved yet.** Click **Save to project** first, then run **Create pull request**.",
                );
                stream.button({ command: "aks.kickstart.acceptAll", title: "💾 Save to project" });
                reportKickstartTelemetry("handoff.not-saved");
                return { metadata: { command: "handoff", error: "not saved" } };
            }

            stream.progress("Creating GitHub pull request...");
            const { handoffToPullRequest } = await import("./handoff");
            const result = await handoffToPullRequest({
                workspacePath: state.projectPath ?? workspaceFolder,
                files,
                token,
                toolInvocationToken: request.toolInvocationToken,
            });

            if (!result.succeeded) {
                stream.markdown(`**Pull request creation failed:**\n\n${result.error}`);
                reportKickstartTelemetry("handoff.failed");
                return { metadata: { command: "handoff", error: result.error } };
            }

            const { pullRequest, branch, repo } = result.result;
            stream.markdown(
                `✅ **Pull request created!**\n\n` +
                    `**Repo:** ${repo.owner}/${repo.repo}\n` +
                    `**Branch:** \`${branch}\`\n` +
                    `**PR #${pullRequest.prNumber}**\n\n`,
            );
            stream.anchor(vscode.Uri.parse(pullRequest.htmlUrl), `🔗 Open PR #${pullRequest.prNumber}`);
            reportKickstartTelemetry("handoff.completed");
            return { metadata: { command: "handoff", prUrl: pullRequest.htmlUrl } };
        }

        if (intent.action === "run" && intent.phase !== undefined) {
            if (!state.projectPath) {
                state.projectPath = workspaceFolder;
                state.projectSource = "workspace";
            }

            const prereqCheck = validatePrereqs(intent.phase, state);
            if (!prereqCheck.ok) {
                const missing = prereqCheck.missing?.join(", ") ?? "unknown prerequisites";
                stream.markdown(`**Missing prerequisites for ${phaseName(intent.phase)}:**\n\n${missing}\n`);
                if (prereqCheck.suggestedPhase !== undefined) {
                    const suggested = phaseName(prereqCheck.suggestedPhase);
                    stream.button({
                        command: `aks.kickstart.${suggested.toLowerCase()}`,
                        title: `Run ${suggested}`,
                    });
                }
                reportKickstartTelemetry(`phase-${intent.phase}.prereq-failed`);
                return { metadata: { command: `phase-${intent.phase}`, error: `Missing prerequisites: ${missing}` } };
            }

            stream.progress(`Running ${phaseName(intent.phase)} phase...`);

            const result = await executePhase(
                intent.phase,
                state,
                stream,
                token,
                request,
                () => {},
                extensionContext.storageUri,
            );

            if (!result.ok) {
                const classification = classifyError(result.error);
                stream.markdown(`**${classification.title}**\n\n${classification.detail}\n`);
                if (classification.fixCommand) {
                    stream.button({ command: classification.fixCommand.id, title: classification.fixCommand.label });
                }
                if (classification.retryable) {
                    stream.button({ command: "aks.kickstart.retry", title: "🔄 Retry" });
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

            if (state.currentPhase === Phase.COMPLETE) {
                stream.markdown("\n🎉 **All done!** Your application is ready on AKS.");
                if (state.verification?.serviceEndpoint) {
                    const ep = state.verification.serviceEndpoint;
                    const appUrl = ep.startsWith("http") ? ep : `http://${ep}`;
                    stream.anchor(vscode.Uri.parse(appUrl), "🌐 Open app");
                }
                if (state.config) {
                    const portalUrl = `https://portal.azure.com/#@/resource/subscriptions/${state.config.subscriptionId}/resourceGroups/${state.config.resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${state.config.clusterName}/overview`;
                    stream.anchor(vscode.Uri.parse(portalUrl), "☁️ Open in Azure Portal");
                }
                if (state.artifacts?.savedToDisk) {
                    stream.markdown("\n\n**Want to commit these changes?**\n");
                    stream.button({
                        command: "aks.kickstart.handoffToPR",
                        title: "🚀 Create pull request",
                    });
                }
            } else if (state.currentPhase === Phase.BUILD && state.artifacts && !state.artifacts.savedToDisk) {
                stream.markdown(
                    `\n✅ **${phaseName(intent.phase)} complete!**\n\nYour files are staged and ready. You can build now, or save them to your workspace first.\n`,
                );
                stream.button({ command: "aks.kickstart.build", title: "Next: Build" });
                stream.button({ command: "aks.kickstart.acceptAll", title: "💾 Save to project" });
            } else if (state.currentPhase <= Phase.VERIFY) {
                const nextPhase = phaseName(state.currentPhase);
                stream.markdown(`\n✅ **${phaseName(intent.phase)} complete!**\n\nReady for the next step?`);
                stream.button({ command: `aks.kickstart.${nextPhase.toLowerCase()}`, title: `Next: ${nextPhase}` });
            }

            reportKickstartTelemetry(`phase-${intent.phase}.completed`);
            return { metadata: { command: `phase-${intent.phase}` } };
        }

        stream.markdown(
            "## 🚀 AKS Kickstart\n\n" +
                "I'll help you containerize and deploy your application to Azure Kubernetes Service (AKS) in minutes.\n\n" +
                "**Here's what I do:**\n" +
                "1. 🔍 **Analyze** your project (language, framework, entry point)\n" +
                "2. ⚙️ **Configure** your Azure target (AKS cluster + container registry)\n" +
                "3. 📦 **Prepare** deployment artifacts (Dockerfile + K8s manifests)\n" +
                "4. 🔨 **Build** and push your container image\n" +
                "5. 🚀 **Deploy** to your AKS cluster\n" +
                "6. ✅ **Verify** everything is running\n\n" +
                "**Choose how to get started:**",
        );
        stream.button({ command: "aks.kickstart.useSample", title: "📦 Use sample repo" });
        stream.button({ command: "aks.kickstart.useWorkspace", title: "📂 Use existing repo" });
        stream.button({ command: "aks.kickstart.createNew", title: "✨ Create something new" });
        reportKickstartTelemetry("welcome.completed");
        return { metadata: { command: "welcome" } };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        stream.markdown(`**Error:** ${message}`);
        reportKickstartTelemetry("handler.error");
        return { metadata: { command: request.command ?? "welcome", error: message } };
    }
}
