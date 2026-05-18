/**
 * Workload Identity Federation (WIF) bootstrap helper for Argo CD.
 *
 * When the Azure-managed Argo CD extension is detected (or Entra ID SSO is
 * configured) AND the application references an Azure-hosted source (ACR or
 * Azure DevOps), this helper replaces the previous "open Microsoft Learn tab"
 * shortcut with a guided 3-step flow:
 *
 *   1. Show the Kubernetes ServiceAccount subject claim Argo CD uses and the
 *      cluster OIDC issuer URL — the two values required to create a
 *      federated credential on a User-Assigned Managed Identity (UAMI) or
 *      App Registration.
 *   2. Open the Azure Portal directly on the relevant Federated Credentials
 *      blade so the user can paste those values.
 *   3. Print the role-assignment guidance (`AcrPull` for ACR,
 *      `Reader` / `Build Reader` for Azure DevOps) and the ServiceAccount
 *      annotation to wire the identity back into the cluster.
 *
 * The Microsoft Learn tutorial is still surfaced as a final fallback.
 *
 * The helper is purely informational — it does not mutate Azure or the
 * cluster.  All resource creation remains in the Azure Portal so the user
 * stays in control.
 */

import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import * as l10n from "@vscode/l10n";

import { invokeKubectlCommand } from "../utils/kubectl";
import { NonZeroExitCodeBehaviour } from "../utils/shell";
import { failed } from "../utils/errorable";
import { getOutputChannel } from "./argoCDInstall";
import type { AzureRepoHost } from "./argoCDApplyApp";

const ARGOCD_NAMESPACE = "argocd";

// Default Argo CD ServiceAccounts that typically need to pull from Azure.
// repo-server pulls Git manifests; image-updater optionally pulls from ACR.
const CANDIDATE_SERVICE_ACCOUNTS = ["argocd-repo-server", "argocd-image-updater", "argocd-application-controller"];

const LEARN_TUTORIAL_URL = "https://learn.microsoft.com/en-us/azure/azure-arc/kubernetes/tutorial-use-gitops-argocd";
const WIF_OVERVIEW_URL =
    "https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust";

type WifContext = {
    serviceAccount: string;
    namespace: string;
    subject: string; // system:serviceaccount:<ns>:<sa>
    issuerUrl: string | undefined;
    existingClientId: string | undefined;
};

// ---------------------------------------------------------------------------
// Entry point — called from argoCDApplyApp's post-apply QuickPick.
// ---------------------------------------------------------------------------

export async function runWifBootstrap(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFilePath: string,
    azureHost: AzureRepoHost,
): Promise<void> {
    const channel = getOutputChannel();
    channel.show(true);
    channel.appendLine(`\n[WIF Bootstrap] Starting Workload Identity Federation helper for ${azureHost} source…`);

    const ctx = await collectWifContext(kubectl, kubeConfigFilePath, channel);
    if (!ctx) return;

    // Multi-step menu — user can re-enter each step.
    while (true) {
        const pick = await vscode.window.showQuickPick(
            [
                {
                    label: "$(info) Step 1 · Show subject claim and issuer",
                    description: l10n.t("Copy the values needed to create a federated credential"),
                    id: "show",
                },
                {
                    label: "$(azure) Step 2 · Open Azure Portal — Managed Identities",
                    description: l10n.t("Pick a UAMI and add a federated credential pointing at this SA"),
                    id: "portal_uami",
                },
                {
                    label: "$(azure) Step 2b · Open Azure Portal — App registrations",
                    description: l10n.t("Alternative: federate to an Entra app registration"),
                    id: "portal_app",
                },
                {
                    label:
                        azureHost === "acr"
                            ? "$(book) Step 3 · Role assignment (AcrPull) + SA annotation"
                            : "$(book) Step 3 · Role assignment (Reader) + SA annotation",
                    description: l10n.t("Print the final wiring steps to the Argo CD output channel"),
                    id: "wire",
                },
                {
                    label: "$(link-external) Open Microsoft Learn tutorial (fallback)",
                    description: l10n.t("Full end-to-end Argo CD + WIF walkthrough"),
                    id: "learn",
                },
            ],
            {
                title: l10n.t("Configure Workload Identity for {0}", azureHost === "acr" ? "ACR" : "Azure DevOps"),
                placeHolder: l10n.t("Select a step (Esc to close)"),
                ignoreFocusOut: true,
            },
        );

        if (!pick) return;

        if (pick.id === "show") {
            await showSubjectAndIssuer(ctx, channel);
        } else if (pick.id === "portal_uami") {
            await vscode.env.openExternal(
                vscode.Uri.parse(
                    "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.ManagedIdentity%2FuserAssignedIdentities",
                ),
            );
        } else if (pick.id === "portal_app") {
            await vscode.env.openExternal(
                vscode.Uri.parse("https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"),
            );
        } else if (pick.id === "wire") {
            await printWiringGuidance(ctx, azureHost, channel);
        } else if (pick.id === "learn") {
            await vscode.env.openExternal(vscode.Uri.parse(LEARN_TUTORIAL_URL));
        }
    }
}

// ---------------------------------------------------------------------------
// Step 0 — discovery
// ---------------------------------------------------------------------------

async function collectWifContext(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFilePath: string,
    channel: vscode.OutputChannel,
): Promise<WifContext | undefined> {
    // Pick a ServiceAccount: prefer one that exists in the argocd namespace.
    let serviceAccount: string | undefined;
    let existingClientId: string | undefined;
    for (const candidate of CANDIDATE_SERVICE_ACCOUNTS) {
        const saResult = await invokeKubectlCommand(
            kubectl,
            kubeConfigFilePath,
            `get sa ${candidate} -n ${ARGOCD_NAMESPACE} -o jsonpath="{.metadata.name},{.metadata.annotations.azure\\.workload\\.identity/client-id}"`,
            NonZeroExitCodeBehaviour.Succeed,
        );
        if (failed(saResult) || saResult.result.code !== 0) continue;
        const [name, clientId] = saResult.result.stdout.split(",");
        if (name && name.trim() !== "") {
            serviceAccount = name.trim();
            existingClientId = clientId?.trim() || undefined;
            break;
        }
    }

    if (!serviceAccount) {
        // Let the user enter one manually — extension may use a custom SA.
        const entered = await vscode.window.showInputBox({
            title: l10n.t("Argo CD ServiceAccount"),
            prompt: l10n.t(
                "Could not auto-detect an Argo CD ServiceAccount in the '{0}' namespace. Enter the SA name to use.",
                ARGOCD_NAMESPACE,
            ),
            value: "argocd-repo-server",
        });
        if (!entered) return undefined;
        serviceAccount = entered;
    }

    // Best-effort: discover the cluster OIDC issuer URL.  AKS exposes this
    // via the public well-known endpoint; if kubectl can't fetch it the
    // user will get it from the cluster properties / Azure Portal.
    let issuerUrl: string | undefined;
    const issuerResult = await invokeKubectlCommand(
        kubectl,
        kubeConfigFilePath,
        `get --raw /.well-known/openid-configuration`,
        NonZeroExitCodeBehaviour.Succeed,
    );
    if (!failed(issuerResult) && issuerResult.result.code === 0) {
        const match = issuerResult.result.stdout.match(/"issuer"\s*:\s*"([^"]+)"/);
        if (match) issuerUrl = match[1];
    }

    const subject = `system:serviceaccount:${ARGOCD_NAMESPACE}:${serviceAccount}`;
    channel.appendLine(`[WIF Bootstrap] ServiceAccount: ${serviceAccount} (namespace=${ARGOCD_NAMESPACE})`);
    channel.appendLine(`[WIF Bootstrap] Federated credential subject: ${subject}`);
    channel.appendLine(`[WIF Bootstrap] OIDC issuer: ${issuerUrl ?? "(unknown — fetch from AKS cluster properties)"}`);
    if (existingClientId) {
        channel.appendLine(`[WIF Bootstrap] Existing azure.workload.identity/client-id on SA: ${existingClientId}`);
    }

    return { serviceAccount, namespace: ARGOCD_NAMESPACE, subject, issuerUrl, existingClientId };
}

// ---------------------------------------------------------------------------
// Step 1 — show values + copy to clipboard
// ---------------------------------------------------------------------------

async function showSubjectAndIssuer(ctx: WifContext, channel: vscode.OutputChannel): Promise<void> {
    channel.appendLine(`\n[WIF Bootstrap] === Step 1: federated credential inputs ===`);
    channel.appendLine(`  Subject (paste into "Subject identifier"):  ${ctx.subject}`);
    channel.appendLine(`  Issuer  (paste into "Issuer URL"):          ${ctx.issuerUrl ?? "(retrieve from cluster)"}`);
    channel.appendLine(`  Audience (default):                          api://AzureADTokenExchange`);

    const action = await vscode.window.showInformationMessage(
        l10n.t(
            "Federated credential inputs:\n\n" +
                "Subject: {0}\n" +
                "Issuer: {1}\n" +
                "Audience: api://AzureADTokenExchange",
            ctx.subject,
            ctx.issuerUrl ?? "(unknown — open AKS cluster → Security configuration → OIDC issuer URL)",
        ),
        { modal: true },
        l10n.t("Copy subject"),
        l10n.t("Copy issuer"),
    );
    if (action === l10n.t("Copy subject")) {
        await vscode.env.clipboard.writeText(ctx.subject);
        vscode.window.showInformationMessage(l10n.t("Subject copied to clipboard."));
    } else if (action === l10n.t("Copy issuer") && ctx.issuerUrl) {
        await vscode.env.clipboard.writeText(ctx.issuerUrl);
        vscode.window.showInformationMessage(l10n.t("Issuer URL copied to clipboard."));
    }
}

// ---------------------------------------------------------------------------
// Step 3 — role assignment + SA annotation guidance
// ---------------------------------------------------------------------------

async function printWiringGuidance(
    ctx: WifContext,
    azureHost: AzureRepoHost,
    channel: vscode.OutputChannel,
): Promise<void> {
    channel.appendLine(`\n[WIF Bootstrap] === Step 3: wire the identity to Azure + the cluster ===`);

    if (azureHost === "acr") {
        channel.appendLine(`  Grant the identity 'AcrPull' on the target Azure Container Registry:`);
        channel.appendLine(
            `    Azure Portal → your ACR → Access control (IAM) → Add role assignment → 'AcrPull' → Managed identity → pick your UAMI.`,
        );
        channel.appendLine(`  Reference: ${WIF_OVERVIEW_URL}`);
    } else if (azureHost === "azure-devops") {
        channel.appendLine(`  Grant the identity access to the Azure DevOps repository:`);
        channel.appendLine(
            `    Azure DevOps → Project settings → Permissions → grant the workload identity (or the Entra group containing it) 'Reader' on the repo.`,
        );
        channel.appendLine(
            `    For pipelines that consume the identity, use service connections of type 'Workload Identity federation'.`,
        );
    }

    channel.appendLine(`\n  Annotate the Argo CD ServiceAccount with the UAMI client id:`);
    channel.appendLine(`    kubectl annotate sa ${ctx.serviceAccount} -n ${ctx.namespace} \\`);
    channel.appendLine(`        azure.workload.identity/client-id=<CLIENT_ID> --overwrite`);
    channel.appendLine(`\n  Then restart the Argo CD workload so the token mount picks up the annotation:`);
    channel.appendLine(`    kubectl rollout restart deploy/${ctx.serviceAccount} -n ${ctx.namespace}`);
    channel.appendLine(`\n  Full walkthrough: ${LEARN_TUTORIAL_URL}`);

    const action = await vscode.window.showInformationMessage(
        l10n.t(
            "Step 3 commands written to the Argo CD output channel. After granting the role and annotating the ServiceAccount, restart the Argo CD workload to apply the change.",
        ),
        l10n.t("Copy annotate command"),
        l10n.t("Open Learn tutorial"),
    );
    if (action === l10n.t("Copy annotate command")) {
        await vscode.env.clipboard.writeText(
            `kubectl annotate sa ${ctx.serviceAccount} -n ${ctx.namespace} azure.workload.identity/client-id=<CLIENT_ID> --overwrite`,
        );
        vscode.window.showInformationMessage(l10n.t("Annotate command copied to clipboard."));
    } else if (action === l10n.t("Open Learn tutorial")) {
        await vscode.env.openExternal(vscode.Uri.parse(LEARN_TUTORIAL_URL));
    }
}
