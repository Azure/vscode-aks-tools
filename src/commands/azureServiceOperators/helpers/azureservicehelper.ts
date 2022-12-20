import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as path from 'path';
import * as fs from 'fs';
import { longRunning } from '../../utils/host';
import * as tmpfile from '../../utils/tempfile';
import { combine, Errorable, failed, getErrorMessage } from '../../utils/errorable';
const tmp = require('tmp');

export interface OperatorSettings {
    readonly tenantId: string;
    readonly subId: string;
    readonly appId: string;
    readonly clientSecret: string;
    readonly cloudEnv: string;
}

export interface InstallOutput {
    readonly ranWithoutError: boolean;
    readonly steps: InstallStep[];
}

export interface InstallStep {
    readonly title: string;
    readonly result: k8s.KubectlV1.ShellResult;
}

// ASO uses different cloud identifiers from VSCode
// (VSCode environments come from ms-rest-azure-env: https://github.com/Azure/ms-rest-azure-env/blob/6fa17ce7f36741af6ce64461735e6c7c0125f0ed/lib/azureEnvironment.ts#L266-L346)
// This is a mapping to the ones used in ASO (https://github.com/Azure/azure-service-operator)
const cloudEnvironment: { [cloudType: string]: string } = {
    AzureChinaCloud: "AzureChinaCloud",
    AzureCloud: "AzurePublicCloud",
    AzureGermanCloud: "AzureGermanCloud",
    AzureUSGovernment: "AzureUSGovernmentCloud",
};

export async function install(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    extensionPath: string,
    clusterKubeConfig: string,
    operatorSettingsInfo: OperatorSettings
): Promise<Errorable<InstallOutput>> {
    // Look up the appropriate cloud name for ASO, and create a copy of the settings with the updated value.
    const cloudName = cloudEnvironment[operatorSettingsInfo.cloudEnv];
    if (!cloudName) {
        return {succeeded: false, error: `Cloud environment name ${operatorSettingsInfo.cloudEnv} is not supported.`};
    }
    operatorSettingsInfo = {...operatorSettingsInfo, cloudEnv: cloudName};

    const hasFailureExitCode = (shellResult: k8s.KubectlV1.ShellResult) => shellResult.code !== 0;
    const steps: InstallStep[] = [];

    // 1) Install Cert-Manager https://azure.github.io/azure-service-operator/.
    // Also, page to refer: https://operatorhub.io/operator/azure-service-operator (Click Install button as top of the page)
    const installCertManagerOutput = await installCertManager(kubectl, clusterKubeConfig);
    if (failed(installCertManagerOutput)) {
        return installCertManagerOutput;
    }
    steps.push({title: "Install Cert Manager Output", result: installCertManagerOutput.result});
    if (hasFailureExitCode(installCertManagerOutput.result)) {
        return {succeeded: true, result: {ranWithoutError: false, steps}};
    }

    // 2) Wait for cert-manager pods to be ready
    const waitForCertManagerOutput = await waitForCertManager(kubectl, clusterKubeConfig);
    if (failed(waitForCertManagerOutput)) {
        return waitForCertManagerOutput;
    }
    steps.push({title: "Wait For Cert Manager Output", result: waitForCertManagerOutput.result});
    if (hasFailureExitCode(waitForCertManagerOutput.result)) {
        return {succeeded: true, result: {ranWithoutError: false, steps}};
    }

    // 3) Install the ASO yaml
    const installOperatorOutput = await installOperator(kubectl, clusterKubeConfig);
    if (failed(installOperatorOutput)) {
        return installOperatorOutput;
    }
    steps.push({title: "Install Operator Output", result: installOperatorOutput.result});
    if (hasFailureExitCode(installOperatorOutput.result)) {
        return {succeeded: true, result: {ranWithoutError: false, steps}};
    }

    // 4) Run kubectl apply for azureoperatorsettings.yaml
    const installSettingsOutput = await installOperatorSettings(kubectl, extensionPath, operatorSettingsInfo, clusterKubeConfig);
    if (failed(installSettingsOutput)) {
        return installSettingsOutput;
    }
    steps.push({title: "Apply Operator Settings Output", result: installSettingsOutput.result});
    if (hasFailureExitCode(installSettingsOutput.result)) {
        return {succeeded: true, result: {ranWithoutError: false, steps}};
    }

    // 5) Final step: Get the azure service operator pod. - kubectl get pods -n azureserviceoperator-system
    const waitForAsoControllerManagerResult = await waitForAsoControllerManager(kubectl, clusterKubeConfig);
    if (failed(waitForAsoControllerManagerResult)) {
        return waitForAsoControllerManagerResult;
    }
    steps.push({title: "Wait For ASO Controller Manager Output", result: waitForAsoControllerManagerResult.result});
    if (hasFailureExitCode(waitForAsoControllerManagerResult.result)) {
        return {succeeded: true, result: {ranWithoutError: false, steps}};
    }

    return {succeeded: true, result: {ranWithoutError: true, steps}};
}

function installCertManager(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    return longRunning(`Installing Cert-Manager resource...`, () => {
        const asoCrdYamlFile = "https://github.com/jetstack/cert-manager/releases/download/v1.7.1/cert-manager.yaml";
        return invokeKubectlCommand(kubectl, clusterKubeConfig, `create -f ${asoCrdYamlFile}`, "Installing cert-manager resource had following error");
    });
}

function waitForCertManager(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    const deployments = ['cert-manager', 'cert-manager-cainjector', 'cert-manager-webhook'];
    return longRunning(`Waiting for Cert-Manager to be ready...`, async () => {
        const promiseResults = await Promise.all(deployments.map(d => {
            return invokeKubectlCommand(kubectl, clusterKubeConfig, `rollout status -n cert-manager deploy/${d} --timeout=240s`, `Waiting for cert-manager deployment ${d} had following error`);
        }));
        const shellResults = combine(promiseResults);
        if (failed(shellResults)) {
            return shellResults;
        }
        // There was no error running the commands, but there may have been a non-zero exit code.
        // Merge the results together, using the first non-zero exit code as the overall result.
        return {
            succeeded: true,
            result: shellResults.result.reduce((sr1, sr2) => ({
                code: sr1.code !== 0 ? sr1.code : sr2.code,
                stdout: `${sr1.stdout}\n${sr2.stdout}`,
                stderr: `${sr1.stderr}\n${sr2.stderr}`
            }))
        };
    });
}

function installOperator(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    return longRunning(`Installing Operator resources...`, () => {
        const asoYamlFile = "https://github.com/Azure/azure-service-operator/releases/download/v2.0.0-beta.3/azureserviceoperator_v2.0.0-beta.3.yaml";
        // Use a larger-than-default request timeout here, because cert-manager sometimes does some certificate re-issuing
        // when ASO resources are created, and it takes time for the inject reconciler (cert-manager-cainjector) to update the resources.
        return invokeKubectlCommand(kubectl, clusterKubeConfig, `create -f ${asoYamlFile} --request-timeout 120s`, "Installing operator resource had following error");
    });
}

async function installOperatorSettings(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    extensionPath: string,
    operatorSettingInfo: OperatorSettings,
    clusterKubeConfig: string
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath, 'resources', 'yaml', 'azureoperatorsettings.yaml'));

    let azureoperatorsettings: string;
    try {
        azureoperatorsettings = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8')
            .replace("<TENANT_ID>", operatorSettingInfo.tenantId)
            .replace("<SUB_ID>", operatorSettingInfo.subId)
            .replace("<APP_ID>", operatorSettingInfo.appId)
            .replace("<CLIENT_SECRET>", operatorSettingInfo.clientSecret)
            .replace("<ENV_CLOUD>", operatorSettingInfo.cloudEnv);
    } catch (e) {
        return {succeeded: false, error: `Failed to read settings template from ${yamlPathOnDisk.fsPath}: ${getErrorMessage(e)}`};
    }

    const templateYaml = tmp.fileSync({ prefix: "aso-operatorsettings", postfix: `.yaml` });
    try {
        fs.writeFileSync(templateYaml.name, azureoperatorsettings);
    } catch (e) {
        return {succeeded: false, error: `Failed to write settings to ${templateYaml.name}: ${getErrorMessage(e)}`};
    }

    return await longRunning(`Installing Azure Service Operator Settings...`, () => {
        // Use a larger-than-default request timeout here, because cert-manager-cainjector is still busy updating resources, increasing response times.
        return invokeKubectlCommand(kubectl, clusterKubeConfig, `apply -f ${templateYaml.name} --request-timeout 120s`, "Install operator settings had following error");
    });
}

async function waitForAsoControllerManager(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    return longRunning(`Waiting for ASO Controller Manager...`, () => {
        return invokeKubectlCommand(kubectl, clusterKubeConfig, "rollout status -n azureserviceoperator-system deploy/azureserviceoperator-controller-manager --timeout=240s", "Waiting for ASO Controller Manager had following error");
    });
}

async function invokeKubectlCommand(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeconfig: string,
    command: string,
    failureDescription: string,
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    try {
        const runResult = await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(clusterKubeconfig, "yaml", async kubeConfigFile => {
            const shellResult = await kubectl.api.invokeCommand(`--kubeconfig="${kubeConfigFile}" ${command}`);
            if (shellResult === undefined) {
                return { succeeded: false, error: `Failed to run kubectl command: ${command}` };
            }
        
            return { succeeded: true, result: shellResult };
        });

        if (failed(runResult)) {
            return {succeeded: false, error: `${failureDescription}: ${runResult.error}`};
        }

        return runResult;
    } catch (e) {
        return {succeeded: false, error: `${failureDescription}: ${getErrorMessage(e)}`};
    }
}
