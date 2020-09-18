import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import AksClusterTreeItem from './tree/aksClusterTreeItem';
import AzureAccountTreeItem from './tree/azureAccountTreeItem';
import { createTelemetryReporter, registerUIExtensionVariables, AzExtTreeDataProvider, AzureUserInput, registerCommand, IActionContext } from 'vscode-azureextensionui';
import selectSubscriptions from './commands/selectSubscriptions';
import detectorDiagnostics from './commands/detectorDiagnostics/detectorDiagnostics';
import periscope from './commands/periscope/periscope';
import * as clusters from './commands/utils/clusters';
import { Reporter, reporter } from './commands/utils/reporter';
import refreshSubscriptions from './commands/refreshSubscriptions';

export async function activate(context: vscode.ExtensionContext) {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    context.subscriptions.push(new Reporter(context));

    if (cloudExplorer.available) {
        // NOTE: This is boilerplate configuration for the Azure UI extension on which this extension relies.
        const uiExtensionVariables = {
            context,
            ignoreBundle: true,
            outputChannel: vscode.window.createOutputChannel('Azure Identity'),
            reporter: createTelemetryReporter(context),
            ui: new AzureUserInput(context.globalState)
        };

        context.subscriptions.push(uiExtensionVariables.outputChannel);

        registerUIExtensionVariables(uiExtensionVariables);

        registerCommandWithTelemetry('aks.selectSubscriptions', selectSubscriptions);
        registerCommandWithTelemetry('aks.detectorDiagnostics', detectorDiagnostics);
        registerCommandWithTelemetry('aks.periscope', periscope);
        registerCommandWithTelemetry('aks.refreshSubscription', refreshSubscriptions);

        const azureAccountTreeItem = new AzureAccountTreeItem();
        context.subscriptions.push(azureAccountTreeItem);
        const treeDataProvider = new AzExtTreeDataProvider(azureAccountTreeItem, 'azureAks.loadMore');

        cloudExplorer.api.registerCloudProvider({
            cloudName: 'Azure',
            treeDataProvider,
            getKubeconfigYaml: getClusterKubeconfig
        });
    } else {
        vscode.window.showWarningMessage(cloudExplorer.reason);
    }
}

async function getClusterKubeconfig(target: AksClusterTreeItem): Promise<string | undefined> {
    return await clusters.getKubeconfigYaml(target);
}

function registerCommandWithTelemetry(command: string, callback: (context: IActionContext, target: any) => any) {
    const wrappedCallback = telemetrise(command, callback);
    return registerCommand(command, wrappedCallback);
}

function telemetrise(command: string, callback: (context: IActionContext, target: any) => any): (context: IActionContext, target: any) => any {
    return (context, target) => {
        if (reporter) {
            reporter.sendTelemetryEvent("command", { command: command });
        }

        return callback(context, target);
    };
}
