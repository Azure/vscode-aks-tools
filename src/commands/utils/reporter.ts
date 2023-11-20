import TelemetryReporter from 'vscode-extension-telemetry';
import vscode = require('vscode');

export let reporter: TelemetryReporter;

export class Reporter extends vscode.Disposable {
    constructor() {
        super(() => reporter.dispose());
        const packageInfo = getPackageInfo();
        if (packageInfo) {
            reporter = packageInfo && new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);
        }
    }
}

interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

function getPackageInfo(): IPackageInfo | undefined {
    const extensionPackage = require('../../../package.json');
    if (extensionPackage) {
        return { name: extensionPackage.name, version: extensionPackage.version, aiKey: extensionPackage.aiKey };
    }
    return;
}