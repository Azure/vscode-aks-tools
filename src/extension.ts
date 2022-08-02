import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import AksClusterTreeItem from './tree/aksClusterTreeItem';
import AzureAccountTreeItem from './tree/azureAccountTreeItem';
import { createAzExtOutputChannel, AzExtTreeDataProvider, registerCommand, IActionContext } from '@microsoft/vscode-azext-utils';
import selectSubscriptions from './commands/selectSubscriptions';
import networkAndConnectivityDiagnostics from './commands/networkAndConnectivityDiagnostics/networkAndConnectivityDiagnostics';
import periscope from './commands/periscope/periscope';
import * as clusters from './commands/utils/clusters';
import { Reporter, reporter } from './commands/utils/reporter';
import installAzureServiceOperator  from './commands/azureServiceOperators/installAzureServiceOperator';
import { AzureResourceNodeContributor } from './tree/azureResourceNodeContributor';
import { setAssetContext } from './assets';
import { configureStarterWorkflow, configureHelmStarterWorkflow, configureKomposeStarterWorkflow, configureKustomizeStarterWorkflow } from './commands/aksStarterWorkflow/configureStarterWorkflow';
import aksCRUDDiagnostics from './commands/aksCRUDDiagnostics/aksCRUDDiagnostics';
import { failed } from './commands/utils/errorable';
import aksBestPracticesDiagnostics from './commands/aksBestPractices/aksBestPractices';
import aksIdentitySecurityDiagnostics from './commands/aksIdentitySecurity/aksIdentitySecurity';
import aksNodeHealth from './commands/aksNodeHealth/aksNodeHealth';
import aksKnownIssuesAvailabilityPerformanceDiagnostics from './commands/aksKnownIssuesAvailabilityPerformance/aksKnownIssuesAvailabilityPerformance';
import aksNavToPortal from './commands/aksNavToPortal/aksNavToPortal';
import aksClusterProperties from './commands/aksClusterProperties/aksClusterProperties';
import aksCreateClusterNavToAzurePortal from './commands/aksCreateClusterNavToAzurePortal/aksCreateClusterNavToAzurePortal';
import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';

export async function activate(context: vscode.ExtensionContext) {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    context.subscriptions.push(new Reporter(context));
    setAssetContext(context);

    if (cloudExplorer.available) {
        // NOTE: This is boilerplate configuration for the Azure UI extension on which this extension relies.
        const uiExtensionVariables = {
            context,
            ignoreBundle: false,
            outputChannel: createAzExtOutputChannel('Azure Identity', ''),
            prefix: ''
        };

        context.subscriptions.push(uiExtensionVariables.outputChannel);

        registerAzureUtilsExtensionVariables(uiExtensionVariables);

        registerCommandWithTelemetry('aks.selectSubscriptions', selectSubscriptions);
        registerCommandWithTelemetry('aks.networkAndConnectivityDiagnostics', networkAndConnectivityDiagnostics);
        registerCommandWithTelemetry('aks.periscope', periscope);
        registerCommandWithTelemetry('aks.installAzureServiceOperator', installAzureServiceOperator );
        registerCommandWithTelemetry('aks.configureStarterWorkflow', configureStarterWorkflow );
        registerCommandWithTelemetry('aks.aksCRUDDiagnostics', aksCRUDDiagnostics );
        registerCommandWithTelemetry('aks.aksBestPracticesDiagnostics', aksBestPracticesDiagnostics );
        registerCommandWithTelemetry('aks.aksIdentitySecurityDiagnostics', aksIdentitySecurityDiagnostics );
        registerCommandWithTelemetry('aks.configureHelmStarterWorkflow', configureHelmStarterWorkflow );
        registerCommandWithTelemetry('aks.configureKomposeStarterWorkflow', configureKomposeStarterWorkflow );
        registerCommandWithTelemetry('aks.configureKustomizeStarterWorkflow', configureKustomizeStarterWorkflow );
        registerCommandWithTelemetry('aks.aksNodeHealthDiagnostics', aksNodeHealth );
        registerCommandWithTelemetry('aks.aksKnownIssuesAvailabilityPerformanceDiagnostics', aksKnownIssuesAvailabilityPerformanceDiagnostics );
        registerCommandWithTelemetry('aks.showInPortal', aksNavToPortal );
        registerCommandWithTelemetry('aks.clusterProperties', aksClusterProperties);
        registerCommandWithTelemetry('aks.createClusterNavToAzurePortal', aksCreateClusterNavToAzurePortal);

        await registerAzureServiceNodes(context);

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

export async function registerAzureServiceNodes(context: vscode.ExtensionContext) {
    const disposables: never[] = [];
    context.subscriptions.push(...disposables);

    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer not available: ${clusterExplorer.reason}`);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl not available: ${kubectl.reason}`);
        return;
    }

    const azureResourceNodeContributor = new AzureResourceNodeContributor(clusterExplorer.api, kubectl.api);
    clusterExplorer.api.registerNodeContributor(azureResourceNodeContributor);
}

async function getClusterKubeconfig(target: AksClusterTreeItem): Promise<string | undefined> {
    const kubeconfig = await clusters.getKubeconfigYaml(target);
    if (failed(kubeconfig)) {
        vscode.window.showErrorMessage(kubeconfig.error);
        return undefined;
    }

    return kubeconfig.result;
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
