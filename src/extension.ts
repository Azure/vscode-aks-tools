import {
    AzExtTreeDataProvider,
    CommandCallback,
    createAzExtOutputChannel,
    registerCommand,
    registerUIExtensionVariables,
} from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { setAssetContext } from "./assets";
import { getReadySessionProvider } from "./auth/azureAuth";
import { activateAzureSessionProvider, getSessionProvider } from "./auth/azureSessionProvider";
import { registerUriHandler } from "./uriHandler";
import { selectSubscriptions, selectTenant, signInToAzure } from "./commands/aksAccount/aksAccount";
import { attachAcrToCluster } from "./commands/aksAttachAcrToCluster/attachAcrToCluster";
import aksClusterProperties from "./commands/aksClusterProperties/aksClusterProperties";
import aksCompareCluster from "./commands/aksCompareCluster/aksCompareCluster";
import aksCreateCluster from "./commands/aksCreateCluster/aksCreateCluster";
import aksCreateClusterNavToAzurePortal from "./commands/aksCreateClusterNavToAzurePortal/aksCreateClusterNavToAzurePortal";
import aksDeleteCluster from "./commands/aksDeleteCluster/aksDeleteCluster";
import aksEraserTool from "./commands/aksEraserTool/erasertool";
import { aksInspektorGadgetShow } from "./commands/aksInspektorGadget/aksInspektorGadget";
import aksKaito from "./commands/aksKaito/aksKaito";
import aksKaitoGenerateYaml from "./commands/aksKaito/akskaitoGenerateYaml";
import aksKaitoCreateCRD from "./commands/aksKaito/aksKaitoCreateCRD";
import aksKaitoManage from "./commands/aksKaito/aksKaitoManage";
import aksKaitoTest from "./commands/aksKaito/aksKaitoTest";
import { aksRunKubectlCommands } from "./commands/aksKubectlCommands/aksKubectlCommands";
import aksNavToPortal from "./commands/aksNavToPortal/aksNavToPortal";
import aksReconcileCluster from "./commands/aksReconcileCluster/aksReconcileCluster";
import { aksDownloadRetinaCapture } from "./commands/aksRetinaCapture/aksDownloadRetinaCapture";
import { aksUploadRetinaCapture } from "./commands/aksRetinaCapture/aksUploadRetinaCapture";
import aksRotateClusterCert from "./commands/aksRotateClusterCert/aksRotateClusterCert";
import { aksTCPDump } from "./commands/aksTCPCollection/tcpDumpCollection";
import installAzureServiceOperator from "./commands/azureServiceOperators/installAzureServiceOperator";
import {
    aksBestPracticesDiagnostics,
    aksCategoryConnectivity,
    aksCCPAvailabilityPerformanceDiagnostics,
    aksCRUDDiagnostics,
    aksIdentitySecurityDiagnostics,
    aksNodeHealth,
    aksStorageDiagnostics,
} from "./commands/detectors/detectors";
import { draftValidate, draftDeployment, draftDockerfile, draftWorkflow } from "./commands/draft/draftCommands";
import periscope from "./commands/periscope/periscope";
import refreshSubscription from "./commands/refreshSubscriptions";
import { getKubeconfigYaml, getManagedCluster } from "./commands/utils/clusters";
import { failed } from "./commands/utils/errorable";
import { longRunning } from "./commands/utils/host";
import { Reporter, reporter } from "./commands/utils/reporter";
import { AksClusterTreeNode } from "./tree/aksClusterTreeItem";
import { createAzureAccountTreeItem } from "./tree/azureAccountTreeItem";
import { AzureResourceNodeContributor } from "./tree/azureResourceNodeContributor";
import { getPlugins } from "./plugins/getPlugins";
import { aksCreateClusterFromCopilot } from "./commands/aksCreateCluster/aksCreateClusterFromCopilot";
import { aksDeployManifest } from "./commands/aksDeployManifest/aksDeployManifest";
import { aksOpenKubectlPanel } from "./commands/aksOpenKubectlPanel/aksOpenKubectlPanel";
import aksClusterFilter from "./commands/utils/clusterfilter";
//import aksAutomatedDeployments from "./commands/devhub/aksAutomatedDeployments";
import aksCreateFleet from "./commands/aksFleet/aksFleetManager";
import aksFleetProperties from "./commands/aksFleetProperties/askFleetProperties";
import deployHeadlamp from "./commands/oservabilitytools/deployHeadlamp/deployHeadlamp";

export async function activate(context: vscode.ExtensionContext) {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    context.subscriptions.push(new Reporter());
    setAssetContext(context);

    registerUriHandler(context);

    // Create and register the Azure session provider before accessing it.
    activateAzureSessionProvider(context);
    const sessionProvider = getSessionProvider();

    if (cloudExplorer.available) {
        // NOTE: This is boilerplate configuration for the Azure UI extension on which this extension relies.
        const uiExtensionVariables = {
            context,
            ignoreBundle: false,
            outputChannel: createAzExtOutputChannel("Azure Identity", ""),
            prefix: "",
        };
        context.subscriptions.push(uiExtensionVariables.outputChannel);

        registerUIExtensionVariables(uiExtensionVariables);
        registerCommandWithTelemetry("aks.signInToAzure", signInToAzure);
        registerCommandWithTelemetry("aks.selectTenant", selectTenant);
        registerCommandWithTelemetry("aks.selectSubscriptions", selectSubscriptions);
        registerCommandWithTelemetry("aks.periscope", periscope);
        registerCommandWithTelemetry("aks.installAzureServiceOperator", installAzureServiceOperator);
        registerCommandWithTelemetry("aks.aksCRUDDiagnostics", aksCRUDDiagnostics);
        registerCommandWithTelemetry("aks.aksBestPracticesDiagnostics", aksBestPracticesDiagnostics);
        registerCommandWithTelemetry("aks.aksIdentitySecurityDiagnostics", aksIdentitySecurityDiagnostics);
        registerCommandWithTelemetry("aks.attachAcrToCluster", attachAcrToCluster);
        registerCommandWithTelemetry("aks.draftDockerfile", draftDockerfile);
        registerCommandWithTelemetry("aks.draftDeployment", draftDeployment);
        registerCommandWithTelemetry("aks.draftWorkflow", draftWorkflow);
        registerCommandWithTelemetry("aks.aksNodeHealthDiagnostics", aksNodeHealth);
        registerCommandWithTelemetry(
            "aks.aksCCPAvailabilityPerformanceDiagnostics",
            aksCCPAvailabilityPerformanceDiagnostics,
        );
        registerCommandWithTelemetry("aks.aksStorageDiagnostics", aksStorageDiagnostics);
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
        registerCommandWithTelemetry("aks.compareCluster", aksCompareCluster);
        registerCommandWithTelemetry("aks.refreshSubscription", refreshSubscription);
        registerCommandWithTelemetry("aks.eraserTool", aksEraserTool);
        registerCommandWithTelemetry("aks.aksDownloadRetinaCapture", aksDownloadRetinaCapture);
        registerCommandWithTelemetry("aks.aksUploadRetinaCapture", aksUploadRetinaCapture);
        registerCommandWithTelemetry("aks.aksKaito", aksKaito);
        registerCommandWithTelemetry("aks.aksKaitoGenerateYaml", aksKaitoGenerateYaml);
        registerCommandWithTelemetry("aks.aksKaitoCreateCRD", aksKaitoCreateCRD);
        registerCommandWithTelemetry("aks.aksKaitoManage", aksKaitoManage);
        registerCommandWithTelemetry("aks.aksKaitoTest", aksKaitoTest);
        registerCommandWithTelemetry("aks.aksCreateClusterFromCopilot", aksCreateClusterFromCopilot);
        registerCommandWithTelemetry("aks.aksDeployManifest", aksDeployManifest);
        registerCommandWithTelemetry("aks.aksOpenKubectlPanel", aksOpenKubectlPanel);
        registerCommandWithTelemetry("aks.getAzureKubernetesServicePlugins", getPlugins);
        registerCommandWithTelemetry("aks.aksDraftValidate", draftValidate);
        registerCommandWithTelemetry("aks.clusterFilter", aksClusterFilter);
        //registerCommandWithTelemetry("aks.aksAutomatedDeployments", aksAutomatedDeployments);
        registerCommandWithTelemetry("aks.aksCreateFleet", aksCreateFleet);
        registerCommandWithTelemetry("aks.aksFleetProperties", aksFleetProperties);
        registerCommandWithTelemetry("aks.deployHeadlamp", deployHeadlamp);

        await registerAzureServiceNodes(context);

        const azureAccountTreeItem = createAzureAccountTreeItem(sessionProvider);
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

async function getClusterKubeconfig(treeNode: AksClusterTreeNode): Promise<string | undefined> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const properties = await longRunning(`Getting properties for cluster ${treeNode.name}.`, () =>
        getManagedCluster(sessionProvider.result, treeNode.subscriptionId, treeNode.resourceGroupName, treeNode.name),
    );
    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return undefined;
    }

    const kubeconfig = await longRunning(`Retrieving kubeconfig for cluster ${treeNode.name}.`, () =>
        getKubeconfigYaml(
            sessionProvider.result,
            treeNode.subscriptionId,
            treeNode.resourceGroupName,
            properties.result,
        ),
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
