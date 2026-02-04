import * as vscode from "vscode";

/**
 * Logger utility for Container Assist that uses VS Code's OutputChannel
 * instead of console.log for better integration with VS Code's output system.
 */
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

    /**
     * Log an info message
     */
    info(message: string): void {
        this.getChannel().appendLine(`[INFO] ${this.timestamp()} ${message}`);
    }

    /**
     * Log an error message
     */
    error(message: string, error?: unknown): void {
        this.getChannel().appendLine(`[ERROR] ${this.timestamp()} ${message}`);
        if (error) {
            if (error instanceof Error) {
                this.getChannel().appendLine(`  ${error.message}`);
                if (error.stack) {
                    this.getChannel().appendLine(`  ${error.stack}`);
                }
            } else {
                this.getChannel().appendLine(`  ${String(error)}`);
            }
        }
    }

    /**
     * Log a debug message with optional data (disabled by default in production)
     */
    debug(message: string, data?: unknown): void {
        const config = vscode.workspace.getConfiguration("aks");
        const debugEnabled = config.get<boolean>("containerAssistDebugLogging", false);

        if (debugEnabled) {
            this.getChannel().appendLine(`[DEBUG] ${this.timestamp()} ${message}`);
            if (data !== undefined) {
                this.getChannel().appendLine(JSON.stringify(data, null, 2));
            }
        }
    }

    /**
     * Log a warning message
     */
    warn(message: string): void {
        this.getChannel().appendLine(`[WARN] ${this.timestamp()} ${message}`);
    }

    /**
     * Show the output channel to the user
     */
    show(): void {
        this.getChannel().show();
    }

    private timestamp(): string {
        return new Date().toISOString();
    }

    /**
     * Dispose the output channel
     */
    dispose(): void {
        this.outputChannel?.dispose();
        this.outputChannel = null;
    }
}

export const logger = ContainerAssistLogger.getInstance();
