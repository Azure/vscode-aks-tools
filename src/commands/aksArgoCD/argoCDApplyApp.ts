/**
 * Argo CD — Apply Application YAML to a cluster.
 *
 * Triggered by right-clicking an Argo CD Application YAML file in the
 * VS Code Explorer or the active editor.  The command:
 *
 *  1. Reads the file and validates it is an `argoproj.io/v1alpha1 Application` manifest.
 *  2. Lets the user pick the target AKS cluster using the shared cluster selector
 *     (same UX as "Deploy Manifest").
 *  3. Checks whether Argo CD is already installed on the cluster.
 *  4. Runs `kubectl apply -n argocd -f <file>` against that cluster.
 *  5. Optionally opens the Argo CD docs for the "sync the application" next step.
 *
 * Reference: https://argo-cd.readthedocs.io/en/stable/getting_started/#6-create-an-application-from-a-git-repository
 */

import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import * as yaml from "js-yaml";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as l10n from "@vscode/l10n";

import { getReadySessionProvider } from "../../auth/azureAuth";
import { invokeKubectlCommand } from "../utils/kubectl";
import { createTempFile } from "../utils/tempfile";
import { failed } from "../utils/errorable";
import { longRunning } from "../utils/host";
import { NonZeroExitCodeBehaviour } from "../utils/shell";
import { selectClusterOptions } from "../../plugins/shared/clusterOptions/selectClusterOptions";
import { ClusterPreference } from "../../plugins/shared/types";

// ---------------------------------------------------------------------------
// Type guard — validate that a parsed YAML doc is an Argo CD Application
// ---------------------------------------------------------------------------

interface ArgoCDApplication {
    apiVersion: string;
    kind: string;
    metadata?: { name?: string; namespace?: string };
}

function isArgoCDApplication(doc: unknown): doc is ArgoCDApplication {
    if (typeof doc !== "object" || doc === null) return false;
    const d = doc as Record<string, unknown>;
    return typeof d.apiVersion === "string" && d.apiVersion.startsWith("argoproj.io/") && d.kind === "Application";
}

// ---------------------------------------------------------------------------
// Parse the YAML file and return the parsed Application, or undefined.
// ---------------------------------------------------------------------------

async function parseApplicationFile(fileUri: vscode.Uri): Promise<ArgoCDApplication | undefined> {
    let rawContent: string;
    try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        rawContent = Buffer.from(bytes).toString("utf8");
    } catch (e) {
        vscode.window.showErrorMessage(l10n.t("Failed to read file: {0}", String(e)));
        return undefined;
    }

    let doc: unknown;
    try {
        doc = yaml.load(rawContent);
    } catch (e) {
        vscode.window.showErrorMessage(l10n.t("Failed to parse YAML: {0}", String(e)));
        return undefined;
    }

    if (!isArgoCDApplication(doc)) {
        vscode.window.showErrorMessage(
            l10n.t(
                "This file does not appear to be an Argo CD Application manifest (expected apiVersion: argoproj.io/v1alpha1, kind: Application).",
            ),
        );
        return undefined;
    }

    return doc;
}

// ---------------------------------------------------------------------------
// Resolve the file URI from various invocation points
// ---------------------------------------------------------------------------

function resolveFileUri(target: unknown): vscode.Uri | undefined {
    if (target instanceof vscode.Uri) return target;

    // Invoked from editor context on the active document.
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) return activeEditor.document.uri;

    return undefined;
}

// ---------------------------------------------------------------------------
// Command: Apply Argo CD Application to Cluster
// ---------------------------------------------------------------------------

export async function argoCDApplyApp(_context: IActionContext, target: unknown): Promise<void> {
    // ------------------------------------------------------------------
    // 1. Resolve the YAML file.
    // ------------------------------------------------------------------
    const fileUri = resolveFileUri(target);
    if (!fileUri) {
        vscode.window.showErrorMessage(
            l10n.t("No file selected. Right-click a YAML file in the Explorer or open it in the editor."),
        );
        return;
    }

    const doc = await parseApplicationFile(fileUri);
    if (!doc) return;

    const appName = doc.metadata?.name ?? "(unnamed)";
    const targetNamespace = doc.metadata?.namespace ?? "argocd";

    // ------------------------------------------------------------------
    // 2. Get the Azure session.
    // ------------------------------------------------------------------
    const sessionResult = await getReadySessionProvider();
    if (failed(sessionResult)) {
        vscode.window.showErrorMessage(sessionResult.error);
        return;
    }

    // ------------------------------------------------------------------
    // 3. Pick the target AKS cluster (consistent with "Deploy Manifest" UX).
    // ------------------------------------------------------------------
    const clusterResult = await selectClusterOptions(sessionResult.result, undefined, "aks.argoCDApplyApp");
    if (failed(clusterResult)) {
        vscode.window.showErrorMessage(clusterResult.error);
        return;
    }

    // User chose "Create new cluster" — stop and let them do that first.
    if (clusterResult.result === true) {
        vscode.window.showInformationMessage(
            l10n.t("Please create an AKS cluster before applying the Argo CD Application."),
        );
        return;
    }

    const cluster = clusterResult.result as ClusterPreference;

    // ------------------------------------------------------------------
    // 4. Ensure kubectl is available.
    // ------------------------------------------------------------------
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showWarningMessage(l10n.t("kubectl is unavailable."));
        return;
    }

    // ------------------------------------------------------------------
    // 5. Write kubeconfig to a temp file.
    // ------------------------------------------------------------------
    const kubeConfigFile = await createTempFile(cluster.kubeConfigYAML, "yaml");

    try {
        // ------------------------------------------------------------------
        // 6. Verify Argo CD is installed (check for argocd namespace).
        // ------------------------------------------------------------------
        const nsCheck = await invokeKubectlCommand(
            kubectl,
            kubeConfigFile.filePath,
            `get namespace argocd --ignore-not-found -o name`,
            NonZeroExitCodeBehaviour.Succeed,
        );

        const argoCDMissing = failed(nsCheck) || nsCheck.result.stdout.trim() === "";

        if (argoCDMissing) {
            const INSTALL_FIRST = l10n.t("Install Argo CD First");
            const APPLY_ANYWAY = l10n.t("Apply Anyway");
            const choice = await vscode.window.showWarningMessage(
                l10n.t(
                    "Argo CD does not appear to be installed on cluster '{0}' (namespace 'argocd' not found).\n\nInstall it first via the cluster right-click menu → 'Install Argo CD on Cluster'.",
                    cluster.clusterName,
                ),
                { modal: true },
                INSTALL_FIRST,
                APPLY_ANYWAY,
            );
            if (!choice || choice === INSTALL_FIRST) return;
        }

        // ------------------------------------------------------------------
        // 7. Apply the manifest to the cluster.
        // ------------------------------------------------------------------
        const applyResult = await longRunning(
            l10n.t("Applying Argo CD Application '{0}' to cluster '{1}'…", appName, cluster.clusterName),
            () =>
                invokeKubectlCommand(
                    kubectl,
                    kubeConfigFile.filePath,
                    `apply -n ${targetNamespace} -f "${fileUri.fsPath}"`,
                ),
        );

        if (failed(applyResult)) {
            vscode.window.showErrorMessage(
                l10n.t("Failed to apply Argo CD Application '{0}': {1}", appName, applyResult.error),
            );
            return;
        }

        const output = applyResult.result.stdout.trim();

        const OPEN_DOCS = l10n.t("Sync the Application (docs)");
        const followUp = await vscode.window.showInformationMessage(
            l10n.t(
                "Argo CD Application '{0}' applied to cluster '{1}'.\n\n{2}\n\nArgo CD will begin syncing from the configured Git repository.",
                appName,
                cluster.clusterName,
                output,
            ),
            OPEN_DOCS,
        );

        if (followUp === OPEN_DOCS) {
            await vscode.env.openExternal(
                vscode.Uri.parse(
                    "https://argo-cd.readthedocs.io/en/stable/getting_started/#7-sync-deploy-the-application",
                ),
            );
        }
    } finally {
        kubeConfigFile.dispose();
    }
}
