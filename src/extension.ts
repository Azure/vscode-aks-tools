import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import AksClusterTreeItem from "./tree/aksClusterTreeItem";
import AzureAccountTreeItem from "./tree/azureAccountTreeItem";
import {
    createAzExtOutputChannel,
    AzExtTreeDataProvider,
    registerCommand,
    CommandCallback,
} from "@microsoft/vscode-azext-utils";
import selectSubscriptions from "./commands/selectSubscriptions";
import periscope from "./commands/periscope/periscope";
import { Reporter, reporter } from "./commands/utils/reporter";
import installAzureServiceOperator from "./commands/azureServiceOperators/installAzureServiceOperator";
import { AzureResourceNodeContributor } from "./tree/azureResourceNodeContributor";
import { setAssetContext } from "./assets";
import {
    configureStarterWorkflow,
    configureHelmStarterWorkflow,
    configureKomposeStarterWorkflow,
    configureKustomizeStarterWorkflow,
} from "./commands/aksStarterWorkflow/configureStarterWorkflow";
import {
    aksCRUDDiagnostics,
    aksBestPracticesDiagnostics,
    aksIdentitySecurityDiagnostics,
    aksNodeHealth,
    aksKnownIssuesAvailabilityPerformanceDiagnostics,
    aksCategoryConnectivity,
} from "./commands/detectors/detectors";
import { failed } from "./commands/utils/errorable";
import aksNavToPortal from "./commands/aksNavToPortal/aksNavToPortal";
import aksClusterProperties from "./commands/aksClusterProperties/aksClusterProperties";
import aksCreateClusterNavToAzurePortal from "./commands/aksCreateClusterNavToAzurePortal/aksCreateClusterNavToAzurePortal";
import { registerAzureUtilsExtensionVariables } from "@microsoft/vscode-azext-azureutils";
import { aksRunKubectlCommands } from "./commands/aksKubectlCommands/aksKubectlCommands";
import { longRunning } from "./commands/utils/host";
import { getClusterProperties, getKubeconfigYaml } from "./commands/utils/clusters";
import aksDeleteCluster from "./commands/aksDeleteCluster/aksDeleteCluster";
import aksRotateClusterCert from "./commands/aksRotateClusterCert/aksRotateClusterCert";
import { aksInspektorGadgetShow } from "./commands/aksInspektorGadget/aksInspektorGadget";
import aksCreateCluster from "./commands/aksCreateCluster/aksCreateCluster";
import aksReconcileCluster from "./commands/aksReconcileCluster/aksReconcileCluster";
import { aksTCPDump } from "./commands/aksTCPCollection/tcpDumpCollection";

export async function activate(context: vscode.ExtensionContext) {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    context.subscriptions.push(new Reporter());
    setAssetContext(context);

    if (cloudExplorer.available) {
        // NOTE: This is boilerplate configuration for the Azure UI extension on which this extension relies.
        const uiExtensionVariables = {
            context,
            ignoreBundle: false,
            outputChannel: createAzExtOutputChannel("Azure Identity", ""),
            prefix: "",
        };

        context.subscriptions.push(uiExtensionVariables.outputChannel);

        registerAzureUtilsExtensionVariables(uiExtensionVariables);
        vscode.commands.executeCommand("workbench.action.openWalkthrough", {
            category: "ms-kubernetes-tools.vscode-aks-tools#aksvscodewalkthrough",
        });
        registerCommandWithTelemetry("aks.selectSubscriptions", selectSubscriptions);
        registerCommandWithTelemetry("aks.periscope", periscope);
        registerCommandWithTelemetry("aks.installAzureServiceOperator", installAzureServiceOperator);
        registerCommandWithTelemetry("aks.configureStarterWorkflow", configureStarterWorkflow);
        registerCommandWithTelemetry("aks.aksCRUDDiagnostics", aksCRUDDiagnostics);
        registerCommandWithTelemetry("aks.aksBestPracticesDiagnostics", aksBestPracticesDiagnostics);
        registerCommandWithTelemetry("aks.aksIdentitySecurityDiagnostics", aksIdentitySecurityDiagnostics);
        registerCommandWithTelemetry("aks.configureHelmStarterWorkflow", configureHelmStarterWorkflow);
        registerCommandWithTelemetry("aks.configureKomposeStarterWorkflow", configureKomposeStarterWorkflow);
        registerCommandWithTelemetry("aks.configureKustomizeStarterWorkflow", configureKustomizeStarterWorkflow);
        registerCommandWithTelemetry("aks.aksNodeHealthDiagnostics", aksNodeHealth);
        registerCommandWithTelemetry(
            "aks.aksKnownIssuesAvailabilityPerformanceDiagnostics",
            aksKnownIssuesAvailabilityPerformanceDiagnostics,
        );
        registerCommandWithTelemetry("aks.showInPortal", aksNavToPortal);
        registerCommandWithTelemetry("aks.clusterProperties", aksClusterProperties);
        registerCommandWithTelemetry("aks.createClusterNavToAzurePortal", aksCreateClusterNavToAzurePortal);
        registerCommandWithTelemetry("aks.aksRunKubectlCommands", aksRunKubectlCommands);
        registerCommandWithTelemetry("aks.aksCategoryConnectivity", aksCategoryConnectivity);
        registerCommandWithTelemetry("aks.aksDeleteCluster", aksDeleteCluster);
        registerCommandWithTelemetry("aks.aksRotateClusterCert", aksRotateClusterCert);
        registerCommandWithTelemetry("aks.aksReconcileCluster", aksReconcileCluster);
        registerCommandWithTelemetry("aks.aksInspektorGadgetShow", aksInspektorGadgetShow);
        registerCommandWithTelemetry("aks.createCluster", aksCreateCluster);
        registerCommandWithTelemetry("aks.aksTCPDump", aksTCPDump);

        await registerAzureServiceNodes(context);

        const azureAccountTreeItem = new AzureAccountTreeItem();
        context.subscriptions.push(azureAccountTreeItem);
        const treeDataProvider = new AzExtTreeDataProvider(azureAccountTreeItem, "azureAks.loadMore");

        cloudExplorer.api.registerCloudProvider({
            cloudName: "Azure",
            treeDataProvider,
            getKubeconfigYaml: getClusterKubeconfig,
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
    const properties = await longRunning(`Getting properties for cluster ${target.name}.`, () =>
        getClusterProperties(target),
    );
    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return undefined;
    }

    const kubeconfig = await longRunning(`Retrieving kubeconfig for cluster ${target.name}.`, () =>
        getKubeconfigYaml(target, properties.result),
    );
    if (failed(kubeconfig)) {
        vscode.window.showErrorMessage(kubeconfig.error);
        return undefined;
    }

    return kubeconfig.result;
}

function registerCommandWithTelemetry(command: string, callback: CommandCallback) {
    const wrappedCallback = telemetrise(command, callback);
    return registerCommand(command, wrappedCallback);
}

function telemetrise(command: string, callback: CommandCallback): CommandCallback {
    return (context, target) => {
        if (reporter) {
            reporter.sendTelemetryEvent("command", { command: command });
        }

        return callback(context, target);
    };
}
