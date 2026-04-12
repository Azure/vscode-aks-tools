/**
 * Argo CD cluster-side commands.
 *
 * Provides two commands triggered from the AKS cluster tree (right-click):
 *
 *  • aks.argoCDInstall      — install Argo CD into the `argocd` namespace of the
 *                             selected cluster using the official stable manifests
 *
 *  • aks.argoCDCheckStatus  — probe whether Argo CD is installed and show a quick
 *                             summary of pod health in an output channel
 *
 * Both commands follow the same kubectl-via-kubeconfig pattern used throughout
 * this extension (e.g. aksKubectlCommands.ts).
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

const ARGOCD_INSTALL_URL = "https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml";

const ARGOCD_NAMESPACE = "argocd";

// Lazy-created output channel — shared between both commands.
let argoCDOutputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!argoCDOutputChannel) {
        argoCDOutputChannel = vscode.window.createOutputChannel("Argo CD");
    }
    return argoCDOutputChannel;
}

// ---------------------------------------------------------------------------
// Shared core: run the actual Argo CD install steps (no cluster resolution,
// no UX prompts — just the kubectl work).  Called both from argoCDInstall and
// from argoCDApplyApp when the user asks to install inline.
// Returns true if the install succeeded.
// ---------------------------------------------------------------------------

export async function performArgoCDInstall(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeconfigFile: string,
    clusterName: string,
    channel: vscode.OutputChannel,
): Promise<boolean> {
    channel.show(true);
    channel.appendLine(`\n[Argo CD Install] Cluster: ${clusterName}`);
    channel.appendLine(`[Argo CD Install] Step 1/2 — Ensuring namespace '${ARGOCD_NAMESPACE}' exists…`);

    const createNsResult = await longRunning(l10n.t("Creating namespace '{0}'…", ARGOCD_NAMESPACE), () =>
        invokeKubectlCommand(
            kubectl,
            kubeconfigFile,
            `create namespace ${ARGOCD_NAMESPACE}`,
            NonZeroExitCodeBehaviour.Succeed,
        ),
    );

    if (failed(createNsResult)) {
        channel.appendLine(`[Argo CD Install] ERROR: ${createNsResult.error}`);
        vscode.window.showErrorMessage(
            l10n.t("Failed to create namespace '{0}': {1}", ARGOCD_NAMESPACE, createNsResult.error),
        );
        return false;
    }
    channel.appendLine(`[Argo CD Install]   ${createNsResult.result.stdout.trim() || "namespace ready"}`);

    channel.appendLine(`[Argo CD Install] Step 2/2 — Applying Argo CD manifests (server-side apply)…`);
    channel.appendLine(`[Argo CD Install]   Source: ${ARGOCD_INSTALL_URL}`);

    const applyResult = await longRunning(
        l10n.t("Installing Argo CD on {0} (this may take a minute)…", clusterName),
        () =>
            invokeKubectlCommand(
                kubectl,
                kubeconfigFile,
                `apply -n ${ARGOCD_NAMESPACE} --server-side --force-conflicts -f ${ARGOCD_INSTALL_URL}`,
            ),
    );

    if (failed(applyResult)) {
        channel.appendLine(`[Argo CD Install] ERROR: ${applyResult.error}`);
        vscode.window.showErrorMessage(l10n.t("Argo CD installation failed: {0}", applyResult.error));
        return false;
    }

    channel.appendLine(`[Argo CD Install]   Resources applied OK.`);
    await showArgoCDStatus(kubectl, kubeconfigFile, clusterName, channel);
    return true;
}

// ---------------------------------------------------------------------------
// Helper: check whether the argocd namespace (and at least one pod) exists
// ---------------------------------------------------------------------------

async function isArgoCDInstalled(kubectl: k8s.APIAvailable<k8s.KubectlV1>, kubeConfigFile: string): Promise<boolean> {
    const result = await invokeKubectlCommand(
        kubectl,
        kubeConfigFile,
        `get namespace ${ARGOCD_NAMESPACE} --ignore-not-found -o name`,
        NonZeroExitCodeBehaviour.Succeed,
    );
    if (failed(result)) return false;
    return result.result.stdout.trim().length > 0;
}

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

// ---------------------------------------------------------------------------
// Command: Install Argo CD
// ---------------------------------------------------------------------------

export async function argoCDInstall(_context: IActionContext, target: unknown): Promise<void> {
    const resolved = await resolveCluster(target);
    if (!resolved) return;

    const { kubectl, clusterInfo } = resolved;
    const channel = getOutputChannel();

    await withOptionalTempFile(clusterInfo.kubeconfigYaml, "yaml", async (kubeconfigFile) => {
        // ------------------------------------------------------------------
        // 1. Check if Argo CD is already installed.
        // ------------------------------------------------------------------
        const alreadyInstalled = await longRunning(
            l10n.t("Checking if Argo CD is already installed on {0}…", clusterInfo.name),
            () => isArgoCDInstalled(kubectl, kubeconfigFile),
        );

        if (alreadyInstalled) {
            const REINSTALL = l10n.t("Reinstall / Upgrade");
            const CHECK_STATUS = l10n.t("Check Status Instead");
            const choice = await vscode.window.showInformationMessage(
                l10n.t(
                    "Argo CD is already installed in the '{0}' namespace on cluster '{1}'.",
                    ARGOCD_NAMESPACE,
                    clusterInfo.name,
                ),
                REINSTALL,
                CHECK_STATUS,
            );
            if (!choice || choice === CHECK_STATUS) {
                await showArgoCDStatus(kubectl, kubeconfigFile, clusterInfo.name, channel);
                return;
            }
            // fall through → (re)install
        }

        // ------------------------------------------------------------------
        // 2. Confirm install.
        // ------------------------------------------------------------------
        if (!alreadyInstalled) {
            const INSTALL = l10n.t("Install");
            const CANCEL = l10n.t("Cancel");
            const confirm = await vscode.window.showInformationMessage(
                l10n.t(
                    "This will install Argo CD into the '{0}' namespace on cluster '{1}' using the official stable manifests.\n\nThe install runs:\n  kubectl create namespace {0}\n  kubectl apply -n {0} --server-side --force-conflicts -f <stable manifests>",
                    ARGOCD_NAMESPACE,
                    clusterInfo.name,
                ),
                { modal: true },
                INSTALL,
                CANCEL,
            );
            if (!confirm || confirm === CANCEL) return;
        }

        // ------------------------------------------------------------------
        // 3. Run the install using the shared helper.
        // ------------------------------------------------------------------
        const ok = await performArgoCDInstall(kubectl, kubeconfigFile, clusterInfo.name, channel);
        if (!ok) return;

        const PORT_FORWARD = l10n.t("Port-forward UI (localhost:8080)");
        const OPEN_DOCS = l10n.t("Open Getting Started Docs");
        const followUp = await vscode.window.showInformationMessage(
            l10n.t(
                "Argo CD installed on '{0}'.  Run 'Check Argo CD Status' from the cluster menu to monitor progress.",
                clusterInfo.name,
            ),
            PORT_FORWARD,
            OPEN_DOCS,
        );

        if (followUp === PORT_FORWARD) {
            await startPortForward(kubectl, kubeconfigFile, clusterInfo.name, channel);
        } else if (followUp === OPEN_DOCS) {
            await vscode.env.openExternal(
                vscode.Uri.parse("https://argo-cd.readthedocs.io/en/stable/getting_started/"),
            );
        }
    });
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
        channel.appendLine(`[Argo CD Status] Tip: use "Install Argo CD on Cluster" from the cluster context menu.`);
        vscode.window.showWarningMessage(
            l10n.t(
                "Argo CD is not installed on cluster '{0}'. Use 'Install Argo CD on Cluster' from the cluster context menu.",
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

// ---------------------------------------------------------------------------
// Helper: start a port-forward for the Argo CD UI in the integrated terminal
// ---------------------------------------------------------------------------

async function startPortForward(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeconfigFile: string,
    clusterName: string,
    channel: vscode.OutputChannel,
): Promise<void> {
    // Check that argocd-server service exists before opening a terminal.
    const svcCheck = await invokeKubectlCommand(
        kubectl,
        kubeconfigFile,
        `get svc argocd-server -n ${ARGOCD_NAMESPACE} --ignore-not-found -o name`,
        NonZeroExitCodeBehaviour.Succeed,
    );

    if (failed(svcCheck) || svcCheck.result.stdout.trim() === "") {
        channel.appendLine(
            `[Argo CD] argocd-server service not ready yet — try port-forwarding manually once all pods are Running.`,
        );
        vscode.window.showWarningMessage(
            l10n.t("argocd-server service is not ready yet. Try again once all pods are Running."),
        );
        return;
    }

    const terminal = vscode.window.createTerminal({
        name: `Argo CD UI — ${clusterName}`,
    });
    terminal.sendText(
        `kubectl port-forward svc/argocd-server -n ${ARGOCD_NAMESPACE} 8080:443 --kubeconfig="${kubeconfigFile}"`,
    );
    terminal.show();
    channel.appendLine(
        `[Argo CD] Port-forward started in terminal. Open https://localhost:8080 (accept self-signed cert).`,
    );
    vscode.window.showInformationMessage(
        l10n.t("Argo CD UI available at https://localhost:8080 (the terminal is running the port-forward)."),
    );
}
