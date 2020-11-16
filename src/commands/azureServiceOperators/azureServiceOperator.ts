import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import * as clusters from '../utils/clusters';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
const tmp = require('tmp');
import * as fs from 'fs';
import { getExtensionPath, longRunning } from '../utils/host';
import * as path from 'path';
import * as tmpfile from '../utils/tempfile';
import { getWebviewContent } from './helpers/azureservicehelper';
const { exec } = require("child_process");

export default async function azureServiceOperator(
    context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (clusterExplorer.available && kubectl.available) {
        const clusterTarget = clusterExplorer.api.resolveCommandTarget(target);

        if (clusterTarget && clusterTarget.nodeType === "context") {
            clusterExplorer.api.refresh();
            await runAzureServiceOperator(clusterTarget);

        } else {
            vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

async function runAzureServiceOperator(
    clusterTarget: any
): Promise<void> {
    // Steps aka Psuedo code for this:
    // 1) Azure Service Operator requires self-signed certificates for CRD Conversion Webhooks: 
    // ---> kubectl apply -f https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml

    const runResult = await longRunning(`Applying Cert Manager for Azure Service Operator.`,
        () => applyCertManager()
    );

    // 2) Install OLM always: that is idempotent.
    // -- which will get the Operator namespace.
    // curl -sL https://github.com/operator-framework/operator-lifecycle-manager/releases/download/0.16.1/install.sh | bash -s 0.16.1
    // Question : How long whould we wait? (I have seen in an unfortunate case of this going more then a 2 minutes.)
    // await vscode.commands.executeCommand('curl -sL https://github.com/operator-framework/operator-lifecycle-manager/releases/download/0.16.1/install.sh | bash -s 0.16.1');

    // 3) kubectl apply -f Issuerandcertmanager.yaml (with fields filled in)
    const runResultIssuer = await longRunning(`Applying Issuer Manager for Azure Service Operator.`,
        () => runASOIssuerCertYAML()
    );

    // 4) Add env var: AZURE_TENANT_ID & AZURE_SUBSCRIPTION_ID
    // 5) UI: make sure user gets serveed with UI of add service principal name as Unique
    // 5.1 --> Run az ad sp create-for-rbac -n "azure-service-operator" --role contributor \
    //          --scopes /subscriptions/$AZURE_SUBSCRIPTION_ID
    const runResultAzAdRbac = await longRunning(`Service Principal hook for Azure Service Operator.`,
        () => applyServicePrincipal(runResult, runResultIssuer)
    );
    // 5.2 --> Once you have created a Service Principal, gather the following values: AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, 
    //         AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_CLOUD_ENV
    // 5.3 --> Azure Environment you'd like to use (Make "AzurePublicCloud" as default but provide AzureUSGovernmentCloud, AzureChinaCloud, AzureGermanCloud.)
    //        as drop down options.
    // const runResultApplyASOSettings = await longRunning(`Service Principal hook for Azure Service Operator.`,
    //     () => applyAzureOperatorSettingsYAML(runResultAzAdRbac.password)
    // );
    // 6 --> Run kubectl apply for azureoperatorsettings.yaml
    // 7:  Last run this command to check if all is done successfully. - kubectl get pods -n operators

    // await vscode.window.showInformationMessage(`Installed Azure Service Operator on: ${clusterTarget.name}.`);
}

async function applyCertManager(): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const kubectl = await k8s.extension.kubectl.v1;
        let runResult;
        if (kubectl.available) {
            runResult = await kubectl.api.invokeCommand(`apply -f https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml`);
        }

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`ASO Cert Manager Deployment file had following error: ${e}`);
        return undefined;
    }
}

async function runASOIssuerCertYAML(): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const extensionPath = getExtensionPath();
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'Issuerandcertmanager.yaml'));

        let fileContents = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');

        const kubectl = await k8s.extension.kubectl.v1;
        let runCommandResult;
        if (kubectl.available) {
            runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                fileContents, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${f}`));
        }

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`ASO Issuer and Cert Deployment file had following error: ${e}`);
        return undefined;
    }
}

async function createAzureServicePrincipal(): Promise<string | undefined> {
    const options: vscode.InputBoxOptions = {
        prompt: "Name for Service Principal: ",
        placeHolder: "(Please make sure you select unique Service Principal Name)"
    };

    const spquickinputBox = await vscode.window.showInputBox(options);
    if (spquickinputBox) {
        vscode.window.showInformationMessage(spquickinputBox);
        return spquickinputBox;
    } else {
        return undefined;
    }

}

async function applyServicePrincipal(
    certManagerOutput: k8s.KubectlV1.ShellResult | undefined,
    issuerOutput: k8s.KubectlV1.ShellResult | undefined
): Promise<any | undefined> {
    try {
        // az ad sp create-for-rbac -n "azure-service-operator" --role contributor \
        // --scopes /subscriptions/$AZURE_SUBSCRIPTION_ID
        // let runResult;

        // UI sample for service Principal name.
        const servicePrincipalInput = await createAzureServicePrincipal();
        // UI sample for the selecting the azure cloud env.
        // await selectAzureCloudEnv();

        const resultAccountShow = await exec("az account show", async (error: { message: any; }, stdout: any, stderr: any) => {
            if (error) {
                console.log(`error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.log(`stderr: ${stderr}`);
                return;
            }
            console.log(`stdout: ${stdout}`);
            const result = JSON.parse(stdout);
            const servicePrincipalCommand = `az ad sp create-for-rbac -n "${servicePrincipalInput}" --role contributor \
            --scopes /subscriptions/${result?.id}`;

            const resultRbac = await exec(servicePrincipalCommand, async (error: { message: any; }, stdout: any, stderr: any) => {
                if (error) {
                    console.log(`error: ${error.message}`);
                    return;
                }
                if (stderr) {
                    console.log(`stderr: ${stderr}`);
                    // return;
                }
                console.log(`stdout: ${stdout}`);
                const resultJsonified = JSON.parse(stdout);
                const runResultApplyASOSettings = await longRunning(`Applying Azure Service Operator Settings.`,
                    () => applyAzureOperatorSettingsYAML(resultJsonified.password)
                );

                const runResultGetOperatorPod = await longRunning(`Getting Azure Service Operator Pod.`,
                    () => getKubectlGetOperatorsPod()
                );
                await createASOWebView("cluster.name", certManagerOutput, issuerOutput, resultJsonified, runResultApplyASOSettings, runResultGetOperatorPod);

                return JSON.parse(stdout);
            });
        });
    } catch (e) {
        vscode.window.showErrorMessage(`Applying Service Principal had following error: ${e}`);
        return undefined;
    }
}

async function applyAzureOperatorSettingsYAML(
    clientSecret: string
) {
    try {
        const extensionPath = getExtensionPath();
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'azureoperatorsettings.yaml'));

        const fileContents = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');
        fileContents.replace("<CLIENT_SECRET>", clientSecret);

        const kubectl = await k8s.extension.kubectl.v1;
        let runCommandResult;
        if (kubectl.available) {
            runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                fileContents, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${f}`));
        }

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Apply ASO Settings had following error: ${e}`);
        return undefined;
    }
}

// kubectl get pods -n operators
async function getKubectlGetOperatorsPod() {
    const kubectl = await k8s.extension.kubectl.v1;
    let runCommandResult;
    if (kubectl.available) {
        const finalOutPut = await kubectl.api.invokeCommand("get pods -n operators");
        return finalOutPut;
    }
}

// Note for : install to be diabled if already installed.
// Vscode wont allow it -- so we might need some hackery with some context value.
// Will try, and see how much work will be in need. Dave and Ivan are chill.
// We scope it at least.
// Defiently have the pinned feature.
// scope \ explore -- maybe for search over tree node, we are not optimistic. Matt C
// Upgrade is not there but that is a future thing.

async function selectAzureCloudEnv() {
    const cloudSelectionDropDownArray: { id: string; label: string; }[] = [];
    // note: Default to what cluster has.
    cloudSelectionDropDownArray.push({ id: "AzurePublicCloud", label: "AzurePublicCloud" });
    cloudSelectionDropDownArray.push({ id: "AzureUSGovernmentCloud", label: "AzureUSGovernmentCloud" });
    cloudSelectionDropDownArray.push({ id: "AzureChinaCloud", label: "AzureChinaCloud" });
    cloudSelectionDropDownArray.push({ id: "AzureGermanCloud", label: "AzureGermanCloud" });

    const cloudEnvQuickPicks = cloudSelectionDropDownArray;

    // Create quick pick for more than 1 storage account scenario.
    const selectedQuickPick = await vscode.window.showQuickPick(
        cloudEnvQuickPicks,
        {
            placeHolder: "Select Azure Cloud Environment for ASO deployment:",
            ignoreFocusOut: true
        });
    if (selectedQuickPick) {
        vscode.window.showInformationMessage(selectedQuickPick.id);
    }
}


async function createASOWebView(
    clusterName: string,
    outputCertManagerResult: k8s.KubectlV1.ShellResult | undefined,
    outputIssuerCertResult: k8s.KubectlV1.ShellResult | undefined,
    outputSPJSONResult: any | undefined,
    outputASOSettingResult: k8s.KubectlV1.ShellResult | undefined,
    outputResult: k8s.KubectlV1.ShellResult | undefined
): Promise<void | undefined> {
    const panel = vscode.window.createWebviewPanel(
        `Azure Service Operator`,
        `Azure service Operator: ${clusterName}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            enableCommandUris: true
        }
    );

    const extensionPath = getExtensionPath();

    if (!extensionPath) {
        return undefined;
    }

    // For the case of successful run of the tool we render webview with the output information.
    panel.webview.html = getWebviewContent(clusterName, extensionPath, outputCertManagerResult, outputIssuerCertResult,
         outputSPJSONResult, outputASOSettingResult, outputResult);

}
