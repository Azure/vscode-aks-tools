/**
 * Argo CD — Apply Application YAML to a cluster.
 *
 * Triggered by right-clicking an Argo CD Application YAML file in the
 * VS Code Explorer or the active editor.  The command:
 *
 *  1. Reads the file and validates it is an `argoproj.io/v1alpha1 Application` manifest.
 *  2. Reads the active kubectl context (no Azure subscription or cluster picker needed).
 *  3. Confirms the target cluster with the user (one click).
 *  4. Checks whether Argo CD is already installed on the cluster.
 *  5. Runs `kubectl apply -n argocd -f <file>` against that cluster.
 *  6. Optionally opens the Argo CD docs for the "sync the application" next step.
 *
 * Reference: https://argo-cd.readthedocs.io/en/stable/getting_started/#6-create-an-application-from-a-git-repository
 */

import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import * as yaml from "js-yaml";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as l10n from "@vscode/l10n";

import { invokeKubectlCommand } from "../utils/kubectl";
import { createTempFile } from "../utils/tempfile";
import { failed } from "../utils/errorable";
import { getAuthenticatedKubeconfigYaml } from "../utils/clusters";
import { longRunning } from "../utils/host";
import { NonZeroExitCodeBehaviour } from "../utils/shell";
import { performArgoCDInstall, getOutputChannel } from "./argoCDInstall";

// ---------------------------------------------------------------------------
// Type guard — validate that a parsed YAML doc is an Argo CD Application
// ---------------------------------------------------------------------------

interface ArgoCDApplication {
    apiVersion: string;
    kind: string;
    metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
    spec?: { source?: { repoURL?: string } };
}

export function isArgoCDApplication(doc: unknown): doc is ArgoCDApplication {
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
// Helper: resolve the current kubectl context + kubeconfig (no Azure auth needed)
// ---------------------------------------------------------------------------

/**
 * Reads the active kubectl context name and the corresponding kubeconfig YAML
 * directly from the local kubeconfig without any Azure subscription lookup.
 * Returns undefined (and shows an error) if kubectl has no current context.
 */
export async function resolveCurrentKubectlContext(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
): Promise<{ contextName: string; kubeconfigYaml: string } | undefined> {
    const ctxResult = await kubectl.api.invokeCommand("config current-context");
    if (!ctxResult || ctxResult.code !== 0) {
        vscode.window.showErrorMessage(
            l10n.t(
                "Could not determine the current kubectl context. Ensure kubectl is configured and a context is active.",
            ),
        );
        return undefined;
    }

    const contextName = ctxResult.stdout.trim();
    if (!contextName) {
        vscode.window.showErrorMessage(
            l10n.t("No active kubectl context found. Run 'kubectl config use-context <name>' to set one."),
        );
        return undefined;
    }

    const cfgResult = await kubectl.api.invokeCommand("config view --minify --flatten -o yaml");
    if (!cfgResult || cfgResult.code !== 0) {
        vscode.window.showErrorMessage(l10n.t("Could not read kubeconfig for context '{0}'.", contextName));
        return undefined;
    }

    // AKS AAD clusters have a kubelogin exec block that calls Azure CLI, which is not on
    // the extension host PATH. Inject the VS Code-managed cached token instead.
    const authenticatedConfig = await getAuthenticatedKubeconfigYaml(cfgResult.stdout);
    if (failed(authenticatedConfig)) {
        vscode.window.showErrorMessage(
            l10n.t("Could not authenticate kubeconfig for context '{0}': {1}", contextName, authenticatedConfig.error),
        );
        return undefined;
    }

    return { contextName, kubeconfigYaml: authenticatedConfig.result };
}

// ---------------------------------------------------------------------------
// Helper: detect whether Argo CD is using Microsoft SSO (workload identity)
// or the classic admin-password flow.
//
// When installed via `az k8s-extension create --extension-type Microsoft.ArgoCD`
// with workload identity, the argocd-cm ConfigMap contains an `oidc.config`
// entry that references login.microsoftonline.com.  In that case the
// argocd-initial-admin-secret is absent and the UI login is handled entirely
// by Microsoft Entra ID — no password prompt needed.
// ---------------------------------------------------------------------------

type ArgoCDAuthMode = "sso" | "admin-password";

async function detectArgoCDAuthMode(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
): Promise<ArgoCDAuthMode> {
    const result = await invokeKubectlCommand(
        kubectl,
        kubeConfigFile,
        `get configmap argocd-cm -n argocd --ignore-not-found -o jsonpath="{.data['oidc\\.config']}"`,
        NonZeroExitCodeBehaviour.Succeed,
    );
    if (failed(result)) return "admin-password";
    const oidcConfig = result.result.stdout.trim().replace(/^"|"$/g, "");
    // Use a strict URL pattern to avoid incomplete substring matching (CodeQL: incomplete-url-substring-sanitization).
    // This ensures the hostname is exactly "login.microsoftonline.com" and not a look-alike domain.
    const isMicrosoftOidc = /https:\/\/login\.microsoftonline\.com\//.test(oidcConfig);
    return isMicrosoftOidc || oidcConfig.includes("useWorkloadIdentity") ? "sso" : "admin-password";
}

// ---------------------------------------------------------------------------
// Helper: fetch Argo CD initial admin credentials from the cluster
// ---------------------------------------------------------------------------

/**
 * Fetches the username and initial admin password from the
 * `argocd-initial-admin-secret` Secret.
 *
 * Argo CD stores the auto-generated password as a base64 value in the
 * `password` field of that Secret.  After a user changes the password via
 * `argocd account update-password`, this Secret is deleted — in that case
 * the function returns undefined and warns the user.
 *
 * Reference: https://argo-cd.readthedocs.io/en/stable/getting_started/#4-login-using-the-cli
 */
async function getArgoCDAdminCredentials(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
): Promise<{ username: string; password: string } | undefined> {
    const result = await longRunning(l10n.t("Fetching Argo CD admin credentials…"), () =>
        invokeKubectlCommand(
            kubectl,
            kubeConfigFile,
            `get secret argocd-initial-admin-secret -n argocd --ignore-not-found ` + `-o jsonpath="{.data.password}"`,
            NonZeroExitCodeBehaviour.Succeed,
        ),
    );

    if (failed(result)) return undefined;

    const b64 = result.result.stdout.trim().replace(/^"|"$/g, "");
    if (!b64) {
        vscode.window.showInformationMessage(
            l10n.t(
                "argocd-initial-admin-secret not found — the password has likely already been changed via 'argocd account update-password' and the secret deleted.",
            ),
        );
        return undefined;
    }

    const password = Buffer.from(b64, "base64").toString("utf8");
    return { username: "admin", password };
}

/**
 * Tries to open the Argo CD UI in the default browser.
 *
 * 1. Detects whether Argo CD was installed with Microsoft SSO (workload identity)
 *    or the OSS admin-password flow, and adjusts the pre-open prompt accordingly.
 * 2. Checks the argocd-server Service for an external LoadBalancer IP/hostname.
 * 3. If found, opens https://<ip-or-hostname> directly.
 * 4. Otherwise, starts a port-forward in an integrated terminal and opens
 *    https://localhost:8080 — the user must keep that terminal open.
 *
 * SSO path  — no credentials are fetched; the browser redirects to Microsoft login.
 * Password path — fetches and displays the initial admin password before opening.
 */
async function openArgoCDUI(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
    clusterName: string,
): Promise<void> {
    // Detect auth mode and (for the password path) fetch credentials in parallel
    // with the LoadBalancer probe so we don't add extra round-trips.
    const [authMode, lbResult] = await Promise.all([
        detectArgoCDAuthMode(kubectl, kubeConfigFile),
        longRunning(l10n.t("Checking for Argo CD external address on '{0}'…", clusterName), () =>
            invokeKubectlCommand(
                kubectl,
                kubeConfigFile,
                `get svc argocd-server -n argocd --ignore-not-found ` +
                    `-o jsonpath='{.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}'`,
                NonZeroExitCodeBehaviour.Succeed,
            ),
        ),
    ]);

    const externalAddr = !failed(lbResult) ? lbResult.result.stdout.trim().replace(/^'|'$/g, "") : "";

    let uiUrl: string;
    let needsPortForward = false;

    if (externalAddr) {
        uiUrl = `https://${externalAddr}`;
    } else {
        // No external address — verify the service exists before starting a port-forward.
        const svcCheck = await longRunning(l10n.t("Checking Argo CD server service on '{0}'…", clusterName), () =>
            invokeKubectlCommand(
                kubectl,
                kubeConfigFile,
                `get svc argocd-server -n argocd --ignore-not-found -o name`,
                NonZeroExitCodeBehaviour.Succeed,
            ),
        );

        if (failed(svcCheck) || svcCheck.result.stdout.trim() === "") {
            vscode.window.showWarningMessage(
                l10n.t(
                    "argocd-server service not found on cluster '{0}'. Argo CD may still be starting up.",
                    clusterName,
                ),
            );
            return;
        }

        uiUrl = "https://localhost:8080";
        needsPortForward = true;
    }

    if (authMode === "sso") {
        // Microsoft SSO path — no admin password exists; the browser will redirect
        // to Microsoft Entra ID automatically.  Just open the URL directly.
        vscode.window.showInformationMessage(
            l10n.t("Opening Argo CD UI ({0}). Sign in with your Microsoft account.", uiUrl),
        );
    } else {
        // Admin-password path — fetch and surface the initial admin password so
        // the user can copy it before the browser tab opens.
        const creds = await getArgoCDAdminCredentials(kubectl, kubeConfigFile);
        if (creds) {
            const COPY_AND_OPEN = l10n.t("Copy Password & Open");
            const OPEN_ONLY = l10n.t("Open Without Copying");

            const credAction = await vscode.window.showInformationMessage(
                l10n.t(
                    "Argo CD UI: {0}\n\nUsername: {1}\nPassword: {2}\n\n(This is the initial admin password from argocd-initial-admin-secret.)",
                    uiUrl,
                    creds.username,
                    creds.password,
                ),
                { modal: true },
                COPY_AND_OPEN,
                OPEN_ONLY,
            );

            if (!credAction) return;

            if (credAction === COPY_AND_OPEN) {
                await vscode.env.clipboard.writeText(creds.password);
                vscode.window.showInformationMessage(l10n.t("Argo CD password copied to clipboard."));
            }
        }
    }

    if (needsPortForward) {
        // Start the port-forward and show the terminal — the user can see the
        // "Forwarding from 127.0.0.1:8080 -> 8080" line appear.
        // We must NOT open the browser immediately; the kubectl process needs a
        // moment to bind the port.  Instead, show a notification with an
        // "Open Browser" button so the user clicks it once the tunnel is ready.
        const terminal = vscode.window.createTerminal({ name: `Argo CD UI — ${clusterName}` });
        terminal.sendText(`kubectl port-forward svc/argocd-server -n argocd 8080:443 --kubeconfig="${kubeConfigFile}"`);
        terminal.show();

        const OPEN_BROWSER = l10n.t("Open Browser");
        const action = await vscode.window.showInformationMessage(
            l10n.t(
                "Port-forward started in terminal 'Argo CD UI — {0}'.\n\nWait for 'Forwarding from 127.0.0.1:8080' to appear in the terminal, then click Open Browser.",
                clusterName,
            ),
            OPEN_BROWSER,
        );
        if (action === OPEN_BROWSER) {
            await vscode.env.openExternal(vscode.Uri.parse(uiUrl));
        }
    } else {
        await vscode.env.openExternal(vscode.Uri.parse(uiUrl));
    }
}

// ---------------------------------------------------------------------------
// Helper: silently probe whether a GitHub repo is public or private
// ---------------------------------------------------------------------------

/**
 * Uses a silent VS Code GitHub session (no sign-in prompt) to call the
 * GitHub REST API and determine repo visibility.
 *
 * Returns:
 *   "public"  — repo exists and is public (Argo CD can pull without credentials)
 *   "private" — repo exists and is private (credentials required)
 *   "unknown" — no silent session, API error, or non-GitHub URL
 */
async function probeGitHubRepoVisibility(repoUrl: string): Promise<"public" | "private" | "unknown"> {
    const urlMatch = repoUrl.trim().match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?\s*$/i);
    if (!urlMatch) return "unknown";
    const [, owner, repoSlug] = urlMatch;

    let session: vscode.AuthenticationSession | undefined;
    try {
        session = await vscode.authentication.getSession("github", ["repo"], {
            createIfNone: false,
            silent: true,
        });
    } catch {
        return "unknown";
    }
    if (!session) return "unknown";

    try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repoSlug}`, {
            headers: {
                Authorization: `Bearer ${session.accessToken}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        });
        if (!res.ok) return "unknown";
        const data = (await res.json()) as { private: boolean };
        return data.private ? "private" : "public";
    } catch {
        return "unknown";
    }
}

// ---------------------------------------------------------------------------
// Helper: connect a private GitHub repo to Argo CD via fine-grained PAT
// ---------------------------------------------------------------------------

/**
 * Full flow for wiring a private GitHub repo into Argo CD:
 *  1. Opens the GitHub fine-grained PAT creation page (pre-filled token name
 *     and, when resolvable, the numeric repo ID).
 *  2. Shows a password input box for the user to paste the PAT back.
 *  3. Applies a labelled Kubernetes Secret in the argocd namespace so Argo CD
 *     picks it up automatically as a repository credential.
 */
async function connectPrivateGitHubRepo(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
    repoUrl: string,
): Promise<void> {
    const urlMatch = repoUrl.trim().match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?\s*$/i);
    if (!urlMatch) return;
    const [, owner, repoSlug] = urlMatch;

    // Silently try to resolve the numeric repo ID + GitHub username.
    let repoId: number | undefined;
    let githubUsername: string | undefined;
    try {
        const session = await vscode.authentication.getSession("github", ["repo"], {
            createIfNone: false,
            silent: true,
        });
        if (session) {
            githubUsername = session.account.label;
            const res = await fetch(`https://api.github.com/repos/${owner}/${repoSlug}`, {
                headers: {
                    Authorization: `Bearer ${session.accessToken}`,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            });
            if (res.ok) {
                const data = (await res.json()) as { id: number };
                repoId = data.id;
            }
        }
    } catch {
        // No session or API error — proceed without ID.
    }

    const tokenName = `argocd-${repoSlug}`
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/-+$/g, "")
        .slice(0, 40);

    const params = new URLSearchParams({ description: tokenName });
    if (repoId !== undefined) {
        params.append("repository_ids[]", String(repoId));
    }
    const patUrl = `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
    const repoNote = repoId !== undefined ? l10n.t(" (repository pre-selected)") : "";

    // Step 1 — open the PAT creation page.
    const OPEN_GITHUB = l10n.t("Open GitHub →");
    const openAction = await vscode.window.showInformationMessage(
        l10n.t(
            "Create a fine-grained PAT for '{0}/{1}':\n\n" +
                "  • Token name: {2}  (pre-filled)\n" +
                "  • Repository access: only '{0}/{1}'{3}\n" +
                "  • Permissions → Contents: Read-only, Metadata: Read-only\n\n" +
                "After creating the token, paste it in the next prompt.",
            owner,
            repoSlug,
            tokenName,
            repoNote,
        ),
        { modal: true },
        OPEN_GITHUB,
    );
    if (openAction === OPEN_GITHUB) {
        await vscode.env.openExternal(vscode.Uri.parse(patUrl));
    }

    // Step 2 — collect the PAT.
    const pat = await vscode.window.showInputBox({
        title: l10n.t("Connect '{0}/{1}' to Argo CD", owner, repoSlug),
        prompt: l10n.t("Paste the fine-grained PAT you just created"),
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : l10n.t("PAT cannot be empty")),
    });
    if (!pat) return;

    // Step 3 — apply the Argo CD repository secret.
    const secretName = `argocd-repo-${repoSlug}`
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/-+$/g, "")
        .slice(0, 63);

    const username = githubUsername ?? "git";
    const httpsUrl = repoUrl.trim().startsWith("http") ? repoUrl.trim() : `https://github.com/${owner}/${repoSlug}.git`;

    const secretYaml = [
        "apiVersion: v1",
        "kind: Secret",
        "metadata:",
        `  name: ${secretName}`,
        "  namespace: argocd",
        "  labels:",
        "    argocd.argoproj.io/secret-type: repository",
        "stringData:",
        "  type: git",
        `  url: ${httpsUrl}`,
        `  username: ${username}`,
        `  password: ${pat}`,
    ].join("\n");

    const tmpFile = await createTempFile(secretYaml, "yaml");
    try {
        const result = await longRunning(l10n.t("Registering repository with Argo CD…"), () =>
            invokeKubectlCommand(
                kubectl,
                kubeConfigFile,
                `apply -f "${tmpFile.filePath}"`,
                NonZeroExitCodeBehaviour.Succeed,
            ),
        );
        if (failed(result) || result.result.code !== 0) {
            const detail = failed(result) ? result.error : result.result.stderr;
            vscode.window.showErrorMessage(l10n.t("Failed to register repository with Argo CD: {0}", detail));
        } else {
            vscode.window.showInformationMessage(
                l10n.t(
                    "Repository '{0}/{1}' connected to Argo CD. " +
                        "Refresh the Repositories page in the Argo CD UI to confirm.",
                    owner,
                    repoSlug,
                ),
            );
        }
    } finally {
        tmpFile.dispose();
    }
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
    // 2. Ensure kubectl is available and read the current cluster context.
    //    No Azure subscription or cluster picker — Argo CD operates on
    //    whichever cluster the user already has as their active context.
    // ------------------------------------------------------------------
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showWarningMessage(l10n.t("kubectl is unavailable."));
        return;
    }

    const ctx = await resolveCurrentKubectlContext(kubectl);
    if (!ctx) return;

    const { contextName: clusterName, kubeconfigYaml } = ctx;

    // ------------------------------------------------------------------
    // 3. Inform the user which cluster will be used and confirm.
    // ------------------------------------------------------------------
    const APPLY = l10n.t("Apply");
    const confirmed = await vscode.window.showInformationMessage(
        l10n.t("Apply Argo CD Application '{0}' to cluster '{1}'?", appName, clusterName),
        APPLY,
    );
    if (!confirmed) return;

    // ------------------------------------------------------------------
    // 4. Write kubeconfig to a temp file.
    // ------------------------------------------------------------------
    const kubeConfigFile = await createTempFile(kubeconfigYaml, "yaml");

    try {
        // 6. Verify Argo CD is installed (check for argocd namespace).
        // ------------------------------------------------------------------
        const nsCheck = await longRunning(l10n.t("Checking if Argo CD is installed on '{0}'…", clusterName), () =>
            invokeKubectlCommand(
                kubectl,
                kubeConfigFile.filePath,
                `get namespace argocd --ignore-not-found -o name`,
                NonZeroExitCodeBehaviour.Succeed,
            ),
        );

        const argoCDMissing = failed(nsCheck) || nsCheck.result.stdout.trim() === "";

        if (argoCDMissing) {
            const INSTALL_NOW = l10n.t("Install Argo CD Now");
            const APPLY_ANYWAY = l10n.t("Apply Anyway");
            const choice = await vscode.window.showWarningMessage(
                l10n.t(
                    "Argo CD is not installed on '{0}' (namespace 'argocd' not found). Install it now, or apply the manifest anyway.",
                    clusterName,
                ),
                { modal: true },
                INSTALL_NOW,
                APPLY_ANYWAY,
            );
            if (!choice) return;
            if (choice === INSTALL_NOW) {
                const channel = getOutputChannel();
                const installed = await performArgoCDInstall(kubectl, kubeConfigFile.filePath, clusterName, channel);
                if (!installed) return;
            }
        }

        // ------------------------------------------------------------------
        // 7. Apply the manifest to the cluster.
        // ------------------------------------------------------------------
        const applyResult = await longRunning(
            l10n.t("Applying Argo CD Application '{0}' to '{1}'…", appName, clusterName),
            () =>
                invokeKubectlCommand(
                    kubectl,
                    kubeConfigFile.filePath,
                    `apply -n ${targetNamespace} -f "${fileUri.fsPath}" --validate=false`,
                ),
        );

        if (failed(applyResult)) {
            vscode.window.showErrorMessage(
                l10n.t("Failed to apply Argo CD Application '{0}': {1}", appName, applyResult.error),
            );
            return;
        }

        const output = applyResult.result.stdout.trim();

        // Log kubectl output to the shared channel.
        const postChannel = getOutputChannel();
        postChannel.appendLine(`\n[Apply] ${appName} → ${clusterName}`);
        postChannel.appendLine(output);

        // ------------------------------------------------------------------
        // Post-apply: detect auth mode and probe repo visibility in parallel
        // so neither probe blocks the other.
        // ------------------------------------------------------------------
        // Prefer the explicit source-repo annotation (set by the deployment wizard)
        // over spec.source.repoURL which points to the GitOps config repo.
        const repoUrl =
            doc.metadata?.annotations?.["aks-extension/source-repo"]?.trim() || doc.spec?.source?.repoURL || "";
        const isGitHub = /github\.com/i.test(repoUrl);

        const [authMode, repoVisibility] = await Promise.all([
            detectArgoCDAuthMode(kubectl, kubeConfigFile.filePath),
            isGitHub ? probeGitHubRepoVisibility(repoUrl) : Promise.resolve("unknown" as const),
        ]);

        // Brief success toast.
        vscode.window.showInformationMessage(l10n.t("✓ '{0}' applied to '{1}'.", appName, clusterName));

        // ------------------------------------------------------------------
        // Persistent follow-up action menu.
        // ------------------------------------------------------------------
        await argoCDPostApplyActions(
            kubectl,
            kubeConfigFile.filePath,
            clusterName,
            appName,
            repoUrl,
            authMode,
            repoVisibility,
        );
    } finally {
        kubeConfigFile.dispose();
    }
}

// ---------------------------------------------------------------------------
// Command: Argo CD Post-Apply Actions (also callable standalone from palette)
// ---------------------------------------------------------------------------

export async function argoCDPostApplyActions(
    _context?: unknown,
    kubectlArg?: unknown,
    kubeConfigFileArg?: unknown,
    clusterNameArg?: unknown,
    appNameArg?: unknown,
    repoUrlArg?: unknown,
    authModeArg?: unknown,
    repoVisibilityArg?: unknown,
): Promise<void> {
    // When called from the command palette we have no pre-resolved context,
    // so resolve kubectl + cluster fresh from the active kubeconfig.
    let kubectl: k8s.APIAvailable<k8s.KubectlV1>;
    let kubeConfigFilePath: string;
    let clusterName: string;
    let appName = "(current cluster)";
    let repoUrl = "";
    let authMode: "sso" | "admin-password";
    let repoVisibility: "public" | "private" | "unknown";
    let ownedTempFile: Awaited<ReturnType<typeof createTempFile>> | undefined;

    // If called programmatically (from argoCDApplyApp) all args are provided.
    const isStandalone =
        !(kubectlArg instanceof Object && "api" in (kubectlArg as object)) || typeof kubeConfigFileArg !== "string";

    if (isStandalone) {
        const k = await k8s.extension.kubectl.v1;
        if (!k.available) {
            vscode.window.showWarningMessage(l10n.t("kubectl is unavailable."));
            return;
        }
        kubectl = k;

        const ctx = await resolveCurrentKubectlContext(kubectl);
        if (!ctx) return;

        ownedTempFile = await createTempFile(ctx.kubeconfigYaml, "yaml");
        kubeConfigFilePath = ownedTempFile.filePath;
        clusterName = ctx.contextName;

        // Read repo URL from the currently active editor — the same file the
        // user just ran "Apply Argo CD Application" on.
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri) {
            const activeDoc = await parseApplicationFile(activeUri);
            if (activeDoc) {
                repoUrl =
                    activeDoc.metadata?.annotations?.["aks-extension/source-repo"]?.trim() ||
                    activeDoc.spec?.source?.repoURL ||
                    "";
                appName = activeDoc.metadata?.name ?? "(current cluster)";
            }
        }

        const isGitHub = /github\.com/i.test(repoUrl);
        const [detectedAuth, detectedVisibility] = await Promise.all([
            detectArgoCDAuthMode(kubectl, kubeConfigFilePath),
            isGitHub ? probeGitHubRepoVisibility(repoUrl) : Promise.resolve("unknown" as const),
        ]);
        authMode = detectedAuth;
        repoVisibility = detectedVisibility;
    } else {
        kubectl = kubectlArg as k8s.APIAvailable<k8s.KubectlV1>;
        kubeConfigFilePath = kubeConfigFileArg as string;
        clusterName = clusterNameArg as string;
        appName = appNameArg as string;
        repoUrl = repoUrlArg as string;
        authMode = authModeArg as "sso" | "admin-password";
        repoVisibility = repoVisibilityArg as "public" | "private" | "unknown";
    }

    try {
        interface ActionItem extends vscode.QuickPickItem {
            id: string;
        }
        const actionItems: ActionItem[] = [
            {
                label: "$(browser) Open Argo CD UI",
                description:
                    authMode === "sso"
                        ? l10n.t("Open the Argo CD dashboard — sign in with your Microsoft account")
                        : l10n.t("Open the Argo CD dashboard in your browser"),
                id: "open_ui",
            },
            ...(repoVisibility === "private"
                ? [
                      {
                          label: "$(key) Connect Private Repository",
                          description: l10n.t(
                              "Create a GitHub fine-grained PAT and add it to Argo CD repository settings",
                          ),
                          id: "connect_repo",
                      } as ActionItem,
                  ]
                : []),
            {
                label: "$(book) Sync Guide",
                description: l10n.t("Open Argo CD docs: sync the application"),
                id: "open_docs",
            },
        ];

        // Loop until the user presses Esc.
        const title =
            appName === "(current cluster)"
                ? l10n.t("Argo CD — '{0}' (Esc to close)", clusterName)
                : l10n.t("Argo CD — '{0}' on '{1}' (Esc to close)", appName, clusterName);

        while (true) {
            const pick = (await vscode.window.showQuickPick(actionItems, {
                title,
                placeHolder: l10n.t("Select an action"),
                ignoreFocusOut: true,
            })) as ActionItem | undefined;

            if (!pick) break;

            if (pick.id === "open_ui") {
                await openArgoCDUI(kubectl, kubeConfigFilePath, clusterName);
            } else if (pick.id === "connect_repo") {
                await connectPrivateGitHubRepo(kubectl, kubeConfigFilePath, repoUrl);
            } else if (pick.id === "open_docs") {
                await vscode.env.openExternal(
                    vscode.Uri.parse(
                        "https://argo-cd.readthedocs.io/en/stable/getting_started/#7-sync-deploy-the-application",
                    ),
                );
            }
        }
    } finally {
        ownedTempFile?.dispose();
    }
}
