import TelemetryReporter from "@vscode/extension-telemetry";
import vscode from "vscode";
import meta from "../../../package.json";

export let reporter: TelemetryReporter;

export class Reporter extends vscode.Disposable {
    constructor() {
        super(() => reporter.dispose());
        reporter = new TelemetryReporter(meta.aiKey);
    }
}
