import * as vscode from "vscode";

class ContainerAssistLogger {
    private outputChannel: vscode.OutputChannel | null = null;
    private static instance: ContainerAssistLogger;

    private constructor() {}

    static getInstance(): ContainerAssistLogger {
        if (!ContainerAssistLogger.instance) {
            ContainerAssistLogger.instance = new ContainerAssistLogger();
        }
        return ContainerAssistLogger.instance;
    }

    private getChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel("Container Assist");
        }
        return this.outputChannel;
    }

    private timestamp(): string {
        return new Date().toISOString();
    }

    info(message: string): void {
        this.getChannel().appendLine(`[INFO] ${this.timestamp()} ${message}`);
    }

    error(message: string, error?: unknown): void {
        this.getChannel().appendLine(`[ERROR] ${this.timestamp()} ${message}`);
        if (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.getChannel().appendLine(`  ${errorMsg}`);
        }
    }

    debug(message: string, data?: unknown): void {
        const config = vscode.workspace.getConfiguration("aks");
        if (!config.get<boolean>("containerAssistDebugLogging", false)) return;

        this.getChannel().appendLine(`[DEBUG] ${this.timestamp()} ${message}`);
        if (data !== undefined) {
            this.getChannel().appendLine(JSON.stringify(data, null, 2));
        }
    }

    warn(message: string): void {
        this.getChannel().appendLine(`[WARN] ${this.timestamp()} ${message}`);
    }

    show(): void {
        this.getChannel().show();
    }

    dispose(): void {
        this.outputChannel?.dispose();
        this.outputChannel = null;
    }
}

export const logger = ContainerAssistLogger.getInstance();
