import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { getAksClusterTreeItem } from '../utils/clusters';
import { getWorkflowYaml, substituteClusterInWorkflowYaml } from '../utils/configureWorkflowHelper';
import { failed } from '../utils/errorable';

export function configureStarterWorkflow(
    _context: IActionContext,
    target: any
): Promise<void> {
    return configureNamedStarterWorkflow(target, "azure-kubernetes-service");
}

export function configureHelmStarterWorkflow(
    _context: IActionContext,
    target: any
): Promise<void> {
    return configureNamedStarterWorkflow(target, "azure-kubernetes-service-helm");
}

export function configureKomposeStarterWorkflow(
    _context: IActionContext,
    target: any
): Promise<void> {
    return configureNamedStarterWorkflow(target, "azure-kubernetes-service-kompose");
}

export function configureKustomizeStarterWorkflow(
    _context: IActionContext,
    target: any
): Promise<void> {
    return configureNamedStarterWorkflow(target, "azure-kubernetes-service-kustomize");
}

async function configureNamedStarterWorkflow(target: any, workflowName: string) {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    // Configure the starter workflow data.
    const starterWorkflowYaml = getWorkflowYaml(workflowName);
    if (failed(starterWorkflowYaml)) {
        vscode.window.showErrorMessage(starterWorkflowYaml.error);
        return;
    }

    const substitutedYaml = substituteClusterInWorkflowYaml(
        starterWorkflowYaml.result,
        cluster.result.armId.split("/")[4],
        cluster.result.name);

    // Display it to the end-user in their vscode editor.
    const doc = await vscode.workspace.openTextDocument({
        content: substitutedYaml,
        language: "yaml"
    });

    vscode.window.showTextDocument(doc);
}
