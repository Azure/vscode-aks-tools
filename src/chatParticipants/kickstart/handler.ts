import * as vscode from "vscode";
import { handleSample, handleStart } from "./orchestrator";
import { reportKickstartTelemetry } from "./telemetry";

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
        reportKickstartTelemetry(request.command ? `${request.command}.invoked` : "welcome.invoked");
        switch (request.command) {
            case undefined:
                stream.markdown(
                    "## Welcome to AKS Kickstart\n\nI can help you containerize your application and deploy it to Azure Kubernetes Service.",
                );
                stream.button({ command: "aks.kickstartContainerization", title: "Open Kickstart panel" });
                stream.button({ command: "aks.kickstart.useWorkspace", title: "Use current workspace" });
                stream.button({ command: "aks.kickstart.useSample", title: "Use a sample" });
                break;
            case "start":
                await handleStart(request, stream, token);
                break;
            case "sample":
                await handleSample(request, stream);
                break;
            default:
                stream.markdown("Unknown command. Try @kickstart /start or @kickstart /sample.");
                break;
        }
        reportKickstartTelemetry(request.command ? `${request.command}.completed` : "welcome.completed");
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        stream.markdown(`**Error:** ${message}`);
    }

    return { metadata: { command: request.command ?? "welcome" } };
}
