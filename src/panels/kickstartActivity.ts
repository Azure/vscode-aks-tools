import * as vscode from "vscode";
import { performance } from "perf_hooks";
import {
    ActivityEntry,
    ActivityFlow,
    ActivityStatus,
    ActivitySnapshot,
    SetupStepStatus,
} from "../webview-contract/webviewDefinitions/kickstartShared";
import { getErrorMessage } from "../commands/utils/errorable";

export interface ActivitySink {
    postActivitySnapshot(snapshot: ActivitySnapshot): void;
}

let kickstartOutputChannel: vscode.OutputChannel | undefined;

export function getKickstartOutputChannel(): vscode.OutputChannel {
    if (!kickstartOutputChannel) {
        kickstartOutputChannel = vscode.window.createOutputChannel("AKS Kickstart");
    }
    return kickstartOutputChannel;
}

export class ScanCancelledError extends Error {
    constructor() {
        super("Kickstart scan cancelled");
        this.name = "ScanCancelledError";
    }
}

export class CancellationToken {
    private cancelled = false;

    cancel(): void {
        this.cancelled = true;
    }

    get isCancelled(): boolean {
        return this.cancelled;
    }

    throwIfCancelled(): void {
        if (this.cancelled) {
            throw new ScanCancelledError();
        }
    }
}

export function formatElapsed(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export interface TimedResult<T> {
    result: T;
    elapsedMs: number;
}

export async function withTiming<T>(
    channel: vscode.OutputChannel,
    label: string,
    fn: () => Promise<T>,
): Promise<TimedResult<T>> {
    const start = performance.now();
    try {
        const result = await fn();
        const elapsedMs = performance.now() - start;
        channel.appendLine(`${timestamp()} ${label} — ${formatElapsed(elapsedMs)}`);
        return { result, elapsedMs };
    } catch (e) {
        const elapsedMs = performance.now() - start;
        channel.appendLine(`${timestamp()} ${label} — ${formatElapsed(elapsedMs)} (failed: ${getErrorMessage(e)})`);
        throw e;
    }
}

function timestamp(): string {
    return `[${new Date().toISOString()}]`;
}

export class ActivityReporter {
    constructor(
        private readonly flow: ActivityFlow,
        private readonly runId: number,
        private readonly sink: ActivitySink,
        private readonly channel: vscode.OutputChannel,
        private readonly token: CancellationToken,
    ) {}

    stage(stage: string, title: string, options?: { collapsible?: boolean }): StageReporter {
        return new StageReporter(
            this.flow,
            this.runId,
            stage,
            title,
            this.sink,
            this.channel,
            this.token,
            options?.collapsible ?? false,
        );
    }
}

export class StageReporter {
    private readonly entries: ActivityEntry[] = [];
    private status: SetupStepStatus = "running";
    private detail?: string;
    private fullError?: string;

    constructor(
        private readonly flow: ActivityFlow,
        private readonly runId: number,
        private readonly stage: string,
        private readonly title: string,
        private readonly sink: ActivitySink,
        private readonly channel: vscode.OutputChannel,
        private readonly token: CancellationToken,
        private readonly collapsible: boolean = false,
    ) {
        this.post();
    }

    async run<T>(action: string, fn: () => Promise<T>, describe?: (result: T) => string | undefined): Promise<T> {
        const index = this.entries.push({ action, status: "running" }) - 1;
        this.post();
        try {
            const { result, elapsedMs } = await withTiming(this.channel, `[${this.stage}] ${action}`, fn);
            this.entries[index] = { action, status: "succeeded", elapsedMs, detail: describe?.(result) };
            this.post();
            return result;
        } catch (e) {
            const status: ActivityStatus = this.token.isCancelled ? "cancelled" : "failed";
            this.entries[index] = { action, status, detail: getErrorMessage(e) };
            this.post();
            throw e;
        }
    }

    succeed(detail?: string): void {
        this.finish("succeeded", detail);
    }

    warn(detail?: string): void {
        this.finish("warning", detail);
    }

    fail(detail?: string, fullError?: string): void {
        this.finish("failed", detail, fullError);
    }

    /**
     * Append a pre-computed entry to this stage. Useful when a single underlying call (e.g.
     * `checkDeploymentPermissions`) returns multiple results that should each show as their own
     * row in the activity list rather than as one timed `run()` entry.
     */
    addEntry(entry: ActivityEntry): void {
        this.entries.push(entry);
        this.post();
    }

    private finish(status: SetupStepStatus, detail?: string, fullError?: string): void {
        this.status = status;
        this.detail = detail;
        this.fullError = fullError;
        this.post();
    }

    private post(): void {
        if (this.token.isCancelled) {
            return;
        }
        this.sink.postActivitySnapshot({
            flow: this.flow,
            runId: this.runId,
            stage: this.stage,
            title: this.title,
            status: this.status,
            entries: this.entries.map((e) => ({ ...e })),
            detail: this.detail,
            fullError: this.fullError,
            collapsible: this.collapsible,
        });
    }
}
