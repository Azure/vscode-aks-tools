/**
 * Argo CD cluster-side commands.
 *
 * Provides the following command triggered from the AKS cluster tree (right-click):
 *
 *  • aks.argoCDCheckStatus  — probe whether Argo CD is installed and show a quick
 *                             summary of pod health in an output channel
 *
 * Argo CD must be pre-installed on the cluster by the user (DevOps engineer)
 * before using the Argo CD deploy scenario.  If Argo CD is not detected, the
 * user is notified and asked to install it manually.
 *
 * Reference: https://argo-cd.readthedocs.io/en/stable/getting_started/
 */

import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as l10n from "@vscode/l10n";

import { getReadySessionProvider } from "../../auth/azureAuth";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { invokeKubectlCommand } from "../utils/kubectl";
import { withOptionalTempFile } from "../utils/tempfile";
import { failed } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { NonZeroExitCodeBehaviour } from "../utils/shell";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARGOCD_NAMESPACE = "argocd";

// ---------------------------------------------------------------------------
// Shared setup: resolve cluster + kubeconfig from tree context
// ---------------------------------------------------------------------------

async function resolveCluster(target: unknown) {
    const [kubectl, cloudExplorer, clusterExplorer, sessionResult] = await Promise.all([
        k8s.extension.kubectl.v1,
        k8s.extension.cloudExplorer.v1,
        k8s.extension.clusterExplorer.v1,
        getReadySessionProvider(),
    ]);

    if (!kubectl.available) {
        vscode.window.showWarningMessage(l10n.t("kubectl is unavailable."));
        return undefined;
    }
    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(l10n.t("Cloud explorer is unavailable."));
        return undefined;
    }
    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(l10n.t("Cluster explorer is unavailable."));
        return undefined;
    }
    if (failed(sessionResult)) {
        vscode.window.showErrorMessage(sessionResult.error);
        return undefined;
    }

    const clusterInfo = await getKubernetesClusterInfo(sessionResult.result, target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return undefined;
    }

    return { kubectl, clusterInfo: clusterInfo.result };
}

// Lazy-created output channel — shared between commands.
let argoCDOutputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!argoCDOutputChannel) {
        argoCDOutputChannel = vscode.window.createOutputChannel("Argo CD");
    }
    return argoCDOutputChannel;
}

// ---------------------------------------------------------------------------
// Command: Check Argo CD Status
// ---------------------------------------------------------------------------

export async function argoCDCheckStatus(_context: IActionContext, target: unknown): Promise<void> {
    const resolved = await resolveCluster(target);
    if (!resolved) return;

    const { kubectl, clusterInfo } = resolved;
    const channel = getOutputChannel();
    channel.show(true);

    await withOptionalTempFile(clusterInfo.kubeconfigYaml, "yaml", async (kubeconfigFile) => {
        await showArgoCDStatus(kubectl, kubeconfigFile, clusterInfo.name, channel);
    });
}

// ---------------------------------------------------------------------------
// Shared helper: print pod status to the output channel
// ---------------------------------------------------------------------------

async function showArgoCDStatus(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeconfigFile: string,
    clusterName: string,
    channel: vscode.OutputChannel,
): Promise<void> {
    channel.appendLine(`\n[Argo CD Status] Cluster: ${clusterName}`);

    // Check namespace existence first.
    const nsCheck = await invokeKubectlCommand(
        kubectl,
        kubeconfigFile,
        `get namespace ${ARGOCD_NAMESPACE} --ignore-not-found -o name`,
        NonZeroExitCodeBehaviour.Succeed,
    );

    if (failed(nsCheck) || nsCheck.result.stdout.trim() === "") {
        channel.appendLine(
            `[Argo CD Status] Namespace '${ARGOCD_NAMESPACE}' not found — Argo CD does not appear to be installed.`,
        );
        channel.appendLine(`[Argo CD Status] Tip: install Argo CD on your cluster before using this functionality.`);
        channel.appendLine(`[Argo CD Status] See: https://argo-cd.readthedocs.io/en/stable/getting_started/`);
        vscode.window.showWarningMessage(
            l10n.t(
                "Argo CD is not installed on cluster '{0}'. Please install Argo CD on your cluster before using this functionality. See https://argo-cd.readthedocs.io/en/stable/getting_started/",
                clusterName,
            ),
        );
        return;
    }

    // Pods.
    const podsResult = await longRunning(l10n.t("Fetching Argo CD pod status from {0}…", clusterName), () =>
        invokeKubectlCommand(
            kubectl,
            kubeconfigFile,
            `get pods -n ${ARGOCD_NAMESPACE} -o wide`,
            NonZeroExitCodeBehaviour.Succeed,
        ),
    );

    channel.appendLine(`[Argo CD Status] Pods in namespace '${ARGOCD_NAMESPACE}':`);
    if (failed(podsResult) || podsResult.result.stdout.trim() === "") {
        channel.appendLine("  (no pods found — installation may still be in progress)");
    } else {
        for (const line of podsResult.result.stdout.trim().split("\n")) {
            channel.appendLine(`  ${line}`);
        }
    }

    // Services.
    const svcResult = await invokeKubectlCommand(
        kubectl,
        kubeconfigFile,
        `get svc -n ${ARGOCD_NAMESPACE}`,
        NonZeroExitCodeBehaviour.Succeed,
    );
    channel.appendLine(`\n[Argo CD Status] Services in namespace '${ARGOCD_NAMESPACE}':`);
    if (failed(svcResult) || svcResult.result.stdout.trim() === "") {
        channel.appendLine("  (none)");
    } else {
        for (const line of svcResult.result.stdout.trim().split("\n")) {
            channel.appendLine(`  ${line}`);
        }
    }

    channel.appendLine(
        `\n[Argo CD Status] Tip: port-forward the UI →  kubectl port-forward svc/argocd-server -n ${ARGOCD_NAMESPACE} 8080:443`,
    );
    channel.appendLine(
        `[Argo CD Status] Auth: if installed via 'az k8s-extension' with workload identity, sign in with your Microsoft account.`,
    );
    channel.appendLine(
        `[Argo CD Status] Auth: if installed via kubectl/Helm, retrieve the initial admin password →  argocd admin initial-password -n ${ARGOCD_NAMESPACE}`,
    );
}
