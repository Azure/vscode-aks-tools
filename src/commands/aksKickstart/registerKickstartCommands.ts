import * as vscode from "vscode";
import { CommandCallback } from "@microsoft/vscode-azext-utils";
import { buildAndPush } from "./buildAndPush";
import { useWorkspace, useSample, KICKSTART_TEMP_ROOT } from "./repoSource";
import { triggerAcceptAll } from "./acceptAll";

type RegisterCommand = (command: string, callback: CommandCallback) => void;

export function registerKickstartCommands(
    context: vscode.ExtensionContext,
    registerCommandWithTelemetry: RegisterCommand,
): void {
    if (!isKickstartEnabled()) {
        return;
    }

    registerCommandWithTelemetry("aks.kickstart.launchExperience", async () => {
        await vscode.commands.executeCommand("workbench.action.closePanel");
        await vscode.commands.executeCommand("workbench.action.closeSidebar");
        await vscode.commands.executeCommand("workbench.action.chat.open", { query: "@kickstart" });
        await vscode.commands.executeCommand("workbench.action.maximizeAuxiliaryBar");
    });

    registerCommandWithTelemetry("aks.kickstart.buildAndPush", buildAndPush);

    registerCommandWithTelemetry("aks.kickstart.openChat", () => openChat());

    showWelcomeWalkthroughOnce(context);

    registerCommandWithTelemetry("aks.kickstart.useWorkspace", async () => {
        const result = await useWorkspace();
        if (!result.succeeded) {
            return;
        }
        context.globalState.update("kickstart.pendingSamplePath", undefined);
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const { loadState, createInitialState, saveState } = await import("../../chatParticipants/kickstart/state");
            const wsFolder = folders[0].uri.fsPath;
            const state = loadState(context, wsFolder) ?? createInitialState(wsFolder);
            state.projectPath = result.result;
            state.projectSource = "workspace";
            await saveState(context, wsFolder, state);
        }
        await openChat("@kickstart /start");
    });

    registerCommandWithTelemetry("aks.kickstart.useSample", async () => {
        const existingFolders = vscode.workspace.workspaceFolders;
        const parentPath =
            existingFolders && existingFolders.length > 0 ? existingFolders[0].uri.fsPath : KICKSTART_TEMP_ROOT;

        const result = await useSample(new vscode.CancellationTokenSource().token, parentPath);
        if (result.succeeded) {
            context.globalState.update("kickstart.pendingSamplePath", result.result);
            if (!existingFolders || existingFolders.length === 0) {
                vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(result.result) });
            }
            await openChat("@kickstart /start");
        } else if (result.error !== "Cancelled.") {
            vscode.window.showErrorMessage(result.error);
        }
    });

    registerCommandWithTelemetry("aks.kickstart.createNew", () => createNewProjectQuickPick());

    const chatCommands: Array<[string, string]> = [
        ["aks.kickstart.resume", "@kickstart resume"],
        ["aks.kickstart.newSession", "@kickstart start over"],
        ["aks.kickstart.analyze", "@kickstart analyze"],
        ["aks.kickstart.configure", "@kickstart configure"],
        ["aks.kickstart.prepare", "@kickstart generate"],
        ["aks.kickstart.build", "@kickstart build"],
        ["aks.kickstart.verify", "@kickstart verify"],
        ["aks.kickstart.retry", "@kickstart retry"],
        ["aks.kickstart.deploy", "@kickstart deploy"],
    ];
    for (const [command, query] of chatCommands) {
        registerCommandWithTelemetry(command, () => openChat(query));
    }

    registerCommandWithTelemetry("aks.kickstart.acceptAll", async () => {
        await triggerAcceptAll(context);
    });

    registerCommandWithTelemetry("aks.kickstart.handoffToPR", async () => {
        await openChat("@kickstart create a pull request");
    });
}

export function isKickstartEnabled(): boolean {
    return !!vscode.workspace.getConfiguration("aks").get<boolean>("kickstartEnabledPreview");
}

async function openChat(query: string = "@kickstart"): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query });
}

function showWelcomeWalkthroughOnce(context: vscode.ExtensionContext): void {
    const hasShownWelcome = context.globalState.get<boolean>("kickstart.welcomeShown");
    if (hasShownWelcome) {
        return;
    }
    vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "ms-kubernetes-tools.vscode-aks-tools#kickstartwalkthrough",
    );
    context.globalState.update("kickstart.welcomeShown", true);
}

async function createNewProjectQuickPick(): Promise<void> {
    const track = await vscode.window.showQuickPick(
        [
            {
                label: "Web App or API",
                description: "Express, FastAPI, .NET, Go, Spring Boot, Django",
                value: "web",
            },
            {
                label: "AI Agent",
                description: "LangChain, RAG, Semantic Kernel",
                value: "agent",
            },
        ],
        { placeHolder: "What do you want to build?", title: "Kickstart: Choose a Track" },
    );
    if (!track) return;

    const frameworks =
        track.value === "web"
            ? ["Next.js", "Express.js", "Python FastAPI", ".NET", "Go", "Spring Boot", "Django", "Rust"]
            : ["LangChain Agent", "RAG App", "Semantic Kernel"];

    const framework = await vscode.window.showQuickPick(
        frameworks.map((f) => ({ label: f })),
        { placeHolder: "Pick a framework", title: "Kickstart: Framework" },
    );
    if (!framework) return;

    const projectKind = track.value === "agent" ? "AI agent" : "web app";
    await openChat(`@kickstart I want to build a ${framework.label} ${projectKind}`);
}
