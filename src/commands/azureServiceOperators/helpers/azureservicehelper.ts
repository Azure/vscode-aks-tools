import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as path from 'path';
import * as fs from 'fs';
import { getExtensionPath } from '../../utils/host';
import { OperatorSettings } from '../models/operatorSettings';
import * as tmpfile from '../../utils/tempfile';
const tmp = require('tmp');

export async function getOperatorsPod(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    // kubectl get pods -n operators
    const command = `get pods -n operators`;
    const failureDescription = "Get operator pod had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installCertManager(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const cerManagerFile = "https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml";
    const command = `apply -f ${cerManagerFile}`;
    const failureDescription = "Cert Manager Rollout had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function checkCertManagerRolloutStatus(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const command = `rollout status -n cert-manager deploy/cert-manager-webhook`;
    const failureDescription = "Cert Manager Rollout had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installOlmCrd(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const asoCrdYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/crds.yaml";
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "yaml",
            (f) => kubectl.invokeCommand(`create -f ${asoCrdYamlFile} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator lifecycle manager CRD resource had following error: ${e}`);
        return undefined;
    }
}

export async function installOlm(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const asoOlmYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/olm.yaml";
    const command = `create -f ${asoOlmYamlFile}`;
    const failureDescription = "Installing operator lifecycle manager resource had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installOperator(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const asoYamlFile = "https://operatorhub.io/install/azure-service-operator.yaml";
    const command = `create -f ${asoYamlFile}`;
    const failureDescription = "Installing operator resoruce had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installIssuerCert(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const extensionPath = getExtensionPath();
    const templateYaml = tmp.fileSync({ prefix: "aso-issuer", postfix: `.yaml` });
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'issuerandcertmanager.yaml'));
    const issuerandcertmanager = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');
    fs.writeFileSync(templateYaml.name, issuerandcertmanager);

    const command = `apply -f ${templateYaml.name}`;
    const failureDescription = "ASO Issuer and Cert Deployment file had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installOperatorSettings(
    kubectl: k8s.KubectlV1,
    operatorSettingInfo: OperatorSettings,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const extensionPath = getExtensionPath();
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'azureoperatorsettings.yaml'));

    const azureoperatorsettings = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8')
        .replace("<TENANT_ID>", operatorSettingInfo.tenantId)
        .replace("<SUB_ID>", operatorSettingInfo.subId)
        .replace("<APP_ID>", operatorSettingInfo.appId)
        .replace("<CLIENT_SECRET>", operatorSettingInfo.clientSecret)
        .replace("<ENV_CLOUD>", operatorSettingInfo.cloudEnv);

    const templateYaml = tmp.fileSync({ prefix: "aso-operatorsettings", postfix: `.yaml` });
    fs.writeFileSync(templateYaml.name, azureoperatorsettings);

    const command = `apply -f ${templateYaml.name}`;
    const failureDescription = "Install operator settings had following error";
    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

async function invokeKubectlCommand(
    kubectl: k8s.KubectlV1,
    clusterKubeconfig: string,
    command: string,
    failureDescription: string,
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeconfig, "yaml",
            (f) => kubectl.invokeCommand(`${command} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`${failureDescription}: ${e}`);
        return undefined;
    }
}