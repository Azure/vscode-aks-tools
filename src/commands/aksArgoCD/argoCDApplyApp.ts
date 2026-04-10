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
import { generateGitHubRepoScopedPat, createGitHubDeployKey, generateSshDeployKeyPair } from "./argoCDDeployment";

// ---------------------------------------------------------------------------
// Type guard — validate that a parsed YAML doc is an Argo CD Application
// ---------------------------------------------------------------------------

interface ArgoCDApplication {
    apiVersion: string;
    kind: string;
    metadata?: { name?: string; namespace?: string };
    spec?: { source?: { repoURL?: string } };
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
// Helper: resolve the current kubectl context + kubeconfig (no Azure auth needed)
// ---------------------------------------------------------------------------

/**
 * Reads the active kubectl context name and the corresponding kubeconfig YAML
 * directly from the local kubeconfig without any Azure subscription lookup.
 * Returns undefined (and shows an error) if kubectl has no current context.
 */
async function resolveCurrentKubectlContext(
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
// Helper: open the Argo CD UI in the browser
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
 * Shows the Argo CD admin credentials with a masked password by default.
 * Offers "Copy Password" and "Reveal Password" actions.
 * Returns the URL that was opened (or undefined if the user just viewed creds).
 */
async function showArgoCDCredentials(kubectl: k8s.APIAvailable<k8s.KubectlV1>, kubeConfigFile: string): Promise<void> {
    const creds = await getArgoCDAdminCredentials(kubectl, kubeConfigFile);
    if (!creds) return;

    const COPY_PASSWORD = l10n.t("Copy Password");
    const REVEAL = l10n.t("Reveal Password");

    const action = await vscode.window.showInformationMessage(
        l10n.t("Argo CD credentials — Username: {0}  |  Password: {1}", creds.username, "••••••••"),
        COPY_PASSWORD,
        REVEAL,
    );

    if (action === COPY_PASSWORD) {
        await vscode.env.clipboard.writeText(creds.password);
        vscode.window.showInformationMessage(l10n.t("Argo CD password copied to clipboard."));
    } else if (action === REVEAL) {
        const reveal = await vscode.window.showInformationMessage(
            l10n.t("Argo CD credentials — Username: {0}  |  Password: {1}", creds.username, creds.password),
            COPY_PASSWORD,
        );
        if (reveal === COPY_PASSWORD) {
            await vscode.env.clipboard.writeText(creds.password);
            vscode.window.showInformationMessage(l10n.t("Argo CD password copied to clipboard."));
        }
    }
}

// ---------------------------------------------------------------------------

/**
 * Tries to open the Argo CD UI in the default browser.
 *
 * 1. Checks the argocd-server Service for an external LoadBalancer IP/hostname.
 * 2. If found, opens https://<ip-or-hostname> directly.
 * 3. Otherwise, starts a port-forward in an integrated terminal and opens
 *    https://localhost:8080 — the user must keep that terminal open.
 *
 * Before opening the browser, fetches and displays the admin credentials so
 * the user can log in immediately.
 */
async function openArgoCDUI(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
    clusterName: string,
): Promise<void> {
    // Fetch credentials first so they're ready when the browser opens.
    const creds = await getArgoCDAdminCredentials(kubectl, kubeConfigFile);

    // Prefer a real LoadBalancer address so the terminal port-forward isn't needed.
    const lbResult = await longRunning(l10n.t("Checking for Argo CD external address on '{0}'…", clusterName), () =>
        invokeKubectlCommand(
            kubectl,
            kubeConfigFile,
            `get svc argocd-server -n argocd --ignore-not-found ` +
                `-o jsonpath='{.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}'`,
            NonZeroExitCodeBehaviour.Succeed,
        ),
    );

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

    // Show credentials before opening the browser so the user can copy the password.
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
// Helper: register a Git repository's credentials with Argo CD
// ---------------------------------------------------------------------------

/**
 * Prompts the user for credentials for a private Git repository and creates
 * (or updates) the corresponding Argo CD repository Secret in the cluster.
 *
 * Supports:
 *  - HTTPS — username + personal access token (GitHub PAT, etc.)
 *  - SSH   — private key file (id_rsa, id_ed25519, etc.)
 *
 * The secret is labelled `argocd.argoproj.io/secret-type: repository` so
 * Argo CD picks it up automatically.
 *
 * Reference: https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/#repositories
 */
async function registerRepoCredentials(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
    defaultRepoUrl: string,
    clusterName: string,
): Promise<void> {
    // 1. Confirm / enter the repository URL.
    const repoUrl = await vscode.window.showInputBox({
        prompt: l10n.t("Git repository URL to register with Argo CD"),
        value: defaultRepoUrl,
        ignoreFocusOut: true,
        validateInput: (v) => (!v || !v.trim() ? l10n.t("Repository URL is required.") : undefined),
    });
    if (!repoUrl) return;

    // 2. For GitHub URLs, silently probe repo visibility first (no sign-in prompt).
    //    • Private repo detected  → auto-generate a 24h repo-scoped PAT and skip the picker.
    //    • Public repo detected   → inform the user (no creds needed) and return.
    //    • Session unavailable or API error → fall through to the manual auth picker below.
    const isGitHubRepo = /github\.com/i.test(repoUrl.trim());
    if (isGitHubRepo) {
        const urlMatch = repoUrl.trim().match(/github\.com[\\/:]([^\\/]+)\/([^\\/.]+?)(?:\.git)?\s*$/i);
        if (urlMatch) {
            const [, owner, repoSlug] = urlMatch;

            // Try to reuse an existing GitHub session without forcing a sign-in prompt.
            let silentSession: vscode.AuthenticationSession | undefined;
            try {
                silentSession = await vscode.authentication.getSession("github", ["repo"], {
                    createIfNone: false,
                    silent: true,
                });
            } catch {
                // No existing session — fall through to the manual picker.
            }

            if (silentSession) {
                // Probe the GitHub API to determine visibility and get the repo ID.
                let repoId: number | undefined;
                let repoIsPrivate: boolean | undefined;
                try {
                    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoSlug}`, {
                        headers: {
                            Authorization: `Bearer ${silentSession.accessToken}`,
                            Accept: "application/vnd.github+json",
                            "X-GitHub-Api-Version": "2022-11-28",
                        },
                    });
                    if (repoRes.ok) {
                        const data = (await repoRes.json()) as { id: number; private: boolean };
                        repoId = data.id;
                        repoIsPrivate = data.private;
                    }
                } catch {
                    // API failure — fall through to the manual picker.
                }

                if (repoIsPrivate === false) {
                    // Public — Argo CD can pull without any credentials.
                    vscode.window.showInformationMessage(
                        l10n.t(
                            "'{0}/{1}' is a public repository — Argo CD can pull from it without credentials.",
                            owner,
                            repoSlug,
                        ),
                    );
                    return;
                }

                if (repoIsPrivate === true && repoId !== undefined) {
                    // Argo CD matches the repository Secret's `url` field to the
                    // application's `spec.source.repoURL` — they must use the same
                    // scheme.  An SSH credential stored as `git@github.com:` will
                    // NEVER be matched to an HTTPS `repoURL`, causing "Connection
                    // Failed" even when the deploy key is perfectly valid.
                    //
                    // Rule: HTTPS repoURL → only ever try HTTPS credentials.
                    //        SSH repoURL  → try SSH deploy key.
                    const isHttpsUrl = /^https?:\/\//i.test(repoUrl.trim());

                    if (isHttpsUrl) {
                        // Try a fine-grained PAT (24h).  This requires a classic PAT
                        // token scope that a VS Code OAuth token can't provide, so it
                        // usually falls through to the manual picker.
                        const patToken = await longRunning(
                            l10n.t("Generating 24-hour repo-scoped GitHub PAT for '{0}/{1}'\u2026", owner, repoSlug),
                            () => generateGitHubRepoScopedPat(silentSession!.accessToken, repoId!, repoSlug),
                        );

                        if (patToken) {
                            const ok = await applyRepoSecret(kubectl, kubeConfigFile, repoUrl.trim(), {
                                type: "git",
                                url: repoUrl.trim(),
                                username: "git",
                                password: patToken,
                            });
                            if (ok) await offerOpenArgoCDUI(kubectl, kubeConfigFile, clusterName);
                            return;
                        }

                        // PAT API unavailable (VS Code OAuth tokens cannot call
                        // POST /user/personal-access-tokens — it requires a classic
                        // PAT scope).  Guide the user to create one manually on
                        // GitHub, collect the pasted token, and register it directly
                        // into Argo CD without any further manual steps.
                        const patFromUser = await guideAndCollectGitHubPat(owner, repoSlug);
                        if (!patFromUser) return;

                        const ok = await applyRepoSecret(kubectl, kubeConfigFile, repoUrl.trim(), {
                            type: "git",
                            url: repoUrl.trim(),
                            username: "git",
                            password: patFromUser.trim(),
                        });
                        if (ok) await offerOpenArgoCDUI(kubectl, kubeConfigFile, clusterName);
                        return;
                    } else {
                        // SSH repoURL — generate a deploy key.
                        const keyPair = generateSshDeployKeyPair();
                        const deployKeyResult = await longRunning(
                            l10n.t("Creating SSH deploy key for '{0}/{1}'\u2026", owner, repoSlug),
                            () =>
                                createGitHubDeployKey(
                                    silentSession!.accessToken,
                                    owner,
                                    repoSlug,
                                    keyPair.publicKeySsh,
                                ),
                        );

                        if (deployKeyResult) {
                            // Patch known-hosts first (argocd-repo-server must trust
                            // GitHub's fingerprint or the SSH handshake is rejected).
                            await ensureGitHubSshKnownHosts(kubectl, kubeConfigFile);
                            const ok = await applyRepoSecret(kubectl, kubeConfigFile, repoUrl.trim(), {
                                type: "git",
                                url: repoUrl.trim(),
                                sshPrivateKey: keyPair.privateKeyPem,
                            });
                            if (ok) {
                                vscode.window.showInformationMessage(
                                    l10n.t(
                                        "Read-only SSH deploy key '{0}' registered on GitHub. To remove it later: https://github.com/{1}/{2}/settings/keys",
                                        deployKeyResult.title,
                                        owner,
                                        repoSlug,
                                    ),
                                );
                                await offerOpenArgoCDUI(kubectl, kubeConfigFile, clusterName);
                            }
                            return;
                        }

                        // Deploy key creation failed — guide to manual setup.
                        const OPEN_GITHUB = l10n.t("Open GitHub");
                        const fallbackAction = await vscode.window.showWarningMessage(
                            l10n.t(
                                "Could not auto-create a deploy key (the organisation may restrict this). Please add one manually in repository Settings \u2192 Deploy keys, then use the SSH option in the auth picker.",
                            ),
                            OPEN_GITHUB,
                        );
                        if (fallbackAction === OPEN_GITHUB) {
                            await vscode.env.openExternal(
                                vscode.Uri.parse(`https://github.com/${owner}/${repoSlug}/settings/keys/new`),
                            );
                        }
                        return;
                    }
                }
                // repoIsPrivate is still undefined (API returned non-OK) → fall through.
            }
        }
    }

    // 3. Manual auth picker — reached for non-GitHub URLs, when no silent session
    //    is available, or when the GitHub API probe failed.
    const authType = await vscode.window.showQuickPick(
        [
            {
                label: "$(lock) HTTPS",
                description: l10n.t("Username + personal access token or password"),
                id: "https",
            },
            {
                label: "$(shield) Bearer token",
                description: l10n.t("OAuth2 / JWT bearer token (GitLab, Azure DevOps, Gitea, Forgejo)"),
                id: "bearer",
            },
            {
                label: "$(key) SSH",
                description: l10n.t("Private key file (id_rsa, id_ed25519, etc.)"),
                id: "ssh",
            },
        ],
        {
            title: l10n.t("Authentication type for '{0}'", repoUrl.trim()),
            ignoreFocusOut: true,
        },
    );
    if (!authType) return;

    let secretStringData: Record<string, string>;

    if (authType.id === "https") {
        // --- HTTPS: username + personal access token / password ---
        const username = await vscode.window.showInputBox({
            prompt: l10n.t("Username (for GitHub PATs any value works, e.g. 'git' or 'token')"),
            value: "git",
            ignoreFocusOut: true,
        });
        if (username === undefined) return;

        const token = await vscode.window.showInputBox({
            prompt: l10n.t("Personal access token or password"),
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) => (!v || !v.trim() ? l10n.t("Token is required.") : undefined),
        });
        if (!token) return;

        secretStringData = {
            type: "git",
            url: repoUrl.trim(),
            username: username.trim() || "git",
            password: token,
        };
    } else if (authType.id === "bearer") {
        // --- Bearer token (Authorization: Bearer <token>) ---
        // Used by GitLab personal/project/group access tokens, Azure DevOps PATs,
        // Gitea/Forgejo tokens, and any provider that speaks OAuth2 token introspection.
        const bearerToken = await vscode.window.showInputBox({
            prompt: l10n.t("Bearer token (will be sent as 'Authorization: Bearer <token>')"),
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) => (!v || !v.trim() ? l10n.t("Token is required.") : undefined),
        });
        if (!bearerToken) return;

        secretStringData = {
            type: "git",
            url: repoUrl.trim(),
            bearerToken: bearerToken.trim(),
        };
    } else {
        // --- SSH: private key file ---
        const keyFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                "Private key files": ["pem", "key", "rsa", "ed25519", "ppk", "openssh"],
                "All files": ["*"],
            },
            title: l10n.t("Select SSH private key file"),
            openLabel: l10n.t("Use this key"),
        });
        if (!keyFiles || keyFiles.length === 0) return;

        let privateKey: string;
        try {
            const bytes = await vscode.workspace.fs.readFile(keyFiles[0]);
            privateKey = Buffer.from(bytes).toString("utf8");
        } catch (e) {
            vscode.window.showErrorMessage(l10n.t("Failed to read private key file: {0}", String(e)));
            return;
        }

        secretStringData = {
            type: "git",
            url: repoUrl.trim(),
            sshPrivateKey: privateKey,
        };
    }

    // For SSH URLs targeting github.com, ensure the known-hosts ConfigMap is
    // populated before registering the key — same as `argocd repo add` does.
    if (/github\.com/i.test(repoUrl.trim()) && secretStringData.sshPrivateKey) {
        await ensureGitHubSshKnownHosts(kubectl, kubeConfigFile);
    }

    const ok = await applyRepoSecret(kubectl, kubeConfigFile, repoUrl.trim(), secretStringData);
    if (ok) await offerOpenArgoCDUI(kubectl, kubeConfigFile, clusterName);
}

/**
 * When the GitHub PAT API is unavailable (VS Code OAuth tokens cannot call
 * POST /user/personal-access-tokens), opens the GitHub fine-grained PAT
 * creation page pre-filled with the correct token name, shows a modal with
 * exact step-by-step instructions (expiry, repo scope, permissions), then
 * presents a password input box to paste the generated token back.
 *
 * Returns the pasted token string, or undefined if the user cancels.
 * The caller is responsible for registering the returned token with Argo CD.
 */
async function guideAndCollectGitHubPat(owner: string, repoSlug: string): Promise<string | undefined> {
    const tokenName = `argocd-${repoSlug}-24h`
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/-+$/g, "")
        .slice(0, 40);

    // GitHub's fine-grained PAT creation page accepts a `description` query
    // parameter to pre-fill the token name field.
    const patUrl = `https://github.com/settings/personal-access-tokens/new?description=${encodeURIComponent(tokenName)}`;

    const OPEN_GITHUB = l10n.t("Open GitHub \u2192");
    const userAction = await vscode.window.showInformationMessage(
        l10n.t(
            "Create a fine-grained GitHub PAT with these exact settings:\n\n" +
                "  \u2022 Token name:  {0}  (pre-filled)\n" +
                "  \u2022 Expiration:  Custom \u2192 1 day\n" +
                "  \u2022 Repository access:  Only select \u2018{1}/{2}\u2019\n" +
                "  \u2022 Permissions \u2192 Contents: Read-only\n" +
                "  \u2022 Permissions \u2192 Metadata: Read-only\n\n" +
                "Click \u2018Open GitHub \u2192\u2019, configure the options above, click \u2018Generate token\u2019, then paste the token into the next prompt.",
            tokenName,
            owner,
            repoSlug,
        ),
        { modal: true },
        OPEN_GITHUB,
    );
    if (userAction !== OPEN_GITHUB) return undefined;

    await vscode.env.openExternal(vscode.Uri.parse(patUrl));

    const pasted = await vscode.window.showInputBox({
        prompt: l10n.t("Paste the generated GitHub PAT \u2014 it will be registered in Argo CD automatically"),
        password: true,
        placeHolder: "github_pat_\u2026",
        ignoreFocusOut: true,
        validateInput: (v) => (!v || !v.trim() ? l10n.t("Token is required.") : undefined),
    });

    return pasted?.trim() || undefined;
}

/**
 * After a successful repo credential registration, offer to open the Argo CD UI
 * directly at Settings → Repositories so the user can verify the connection status.
 */
async function offerOpenArgoCDUI(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
    clusterName: string,
): Promise<void> {
    const OPEN_UI = l10n.t("View in Argo CD (Settings → Repositories)");
    const action = await vscode.window.showInformationMessage(
        l10n.t("Open the Argo CD UI to verify the repository connection status under Settings → Repositories."),
        OPEN_UI,
    );
    if (action === OPEN_UI) {
        await openArgoCDUI(kubectl, kubeConfigFile, clusterName);
    }
}

// ---------------------------------------------------------------------------
// Helper: ensure GitHub SSH host keys are present in argocd-ssh-known-hosts-cm
// ---------------------------------------------------------------------------

/**
 * Mirrors what `argocd repo add --ssh-private-key-path` does automatically:
 * fetches GitHub's current SSH public host keys from the GitHub meta API and
 * patches the `argocd-ssh-known-hosts-cm` ConfigMap with any that are missing.
 *
 * Without this, Argo CD refuses to open the SSH connection ("unknown host"),
 * so the repository shows "not connected" even when the deploy key is correct.
 *
 * Reference:
 *   https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/#ssh-known-host-public-keys
 *   https://docs.github.com/en/rest/meta/meta#get-github-meta-information
 */
async function ensureGitHubSshKnownHosts(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
): Promise<void> {
    // 1. Fetch GitHub's current SSH host keys.
    let githubKeys: string[];
    try {
        const res = await fetch("https://api.github.com/meta", {
            headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const meta = (await res.json()) as { ssh_keys?: string[] };
        githubKeys = (meta.ssh_keys ?? []).filter((k) => k.trim().length > 0);
    } catch (e) {
        vscode.window.showWarningMessage(
            l10n.t(
                "Could not fetch GitHub SSH host keys ({0}). Argo CD may show the repository as disconnected until you add them manually.",
                String(e),
            ),
        );
        return;
    }

    if (githubKeys.length === 0) return;

    // 2. Read the current known-hosts ConfigMap.
    const getResult = await invokeKubectlCommand(
        kubectl,
        kubeConfigFile,
        `get cm argocd-ssh-known-hosts-cm -n argocd -o jsonpath="{.data.ssh_known_hosts}"`,
        NonZeroExitCodeBehaviour.Succeed,
    );

    const existing = !failed(getResult) ? getResult.result.stdout.trim().replace(/^"|"$/g, "") : "";

    // 3. Build the merged known-hosts block — add only missing entries.
    const existingLines = new Set(
        existing
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
    );
    const toAdd = githubKeys.map((k) => `github.com ${k.trim()}`).filter((line) => !existingLines.has(line));

    if (toAdd.length === 0) return; // already up to date

    const merged = `${[...existingLines, ...toAdd].join("\n")}\n`;

    // 4. Patch the ConfigMap.  Use a JSON merge-patch via a temp file to avoid
    //    shell quoting issues with the multi-line value.
    const patchObj = { data: { ssh_known_hosts: merged } };
    const patchFile = await createTempFile(JSON.stringify(patchObj), "json");
    try {
        const patchResult = await invokeKubectlCommand(
            kubectl,
            kubeConfigFile,
            `patch cm argocd-ssh-known-hosts-cm -n argocd --type=merge --patch-file "${patchFile.filePath}"`,
        );
        if (failed(patchResult)) {
            vscode.window.showWarningMessage(
                l10n.t("Could not patch argocd-ssh-known-hosts-cm: {0}", patchResult.error),
            );
            return;
        }
    } finally {
        patchFile.dispose();
    }

    // 5. Restart argocd-repo-server so it picks up the updated ConfigMap immediately.
    //    Without this, the pod keeps using the copy it loaded at startup and SSH
    //    connections fail with "unknown host" until the next pod restart.
    await invokeKubectlCommand(
        kubectl,
        kubeConfigFile,
        `rollout restart deployment/argocd-repo-server -n argocd`,
        NonZeroExitCodeBehaviour.Succeed,
    );
}

// ---------------------------------------------------------------------------
// Helper: build + kubectl-apply an Argo CD repository Secret
// ---------------------------------------------------------------------------

async function applyRepoSecret(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
    repoUrl: string,
    secretStringData: Record<string, string>,
): Promise<boolean> {
    // Build a valid Kubernetes Secret name from the repo URL.
    const secretName = `repo-${repoUrl
        .replace(/^https?:\/\/|^git@|\.git$/g, "")
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase()
        .replace(/^-+|-+$/g, "")
        .slice(0, 50)
        .replace(/-+$/g, "")}`;

    // Serialize the secret object via js-yaml to avoid YAML injection.
    const secretObj = {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
            name: secretName,
            namespace: "argocd",
            labels: { "argocd.argoproj.io/secret-type": "repository" },
        },
        stringData: secretStringData,
    };
    const secretYaml = yaml.dump(secretObj);

    // Apply via a temp file (never log credentials to output channels).
    const tmpFile = await createTempFile(secretYaml, "yaml");
    try {
        const result = await longRunning(l10n.t("Registering repository credentials with Argo CD…"), () =>
            invokeKubectlCommand(kubectl, kubeConfigFile, `apply -f "${tmpFile.filePath}"`),
        );

        if (failed(result)) {
            vscode.window.showErrorMessage(l10n.t("Failed to register repository credentials: {0}", result.error));
            return false;
        }

        vscode.window.showInformationMessage(l10n.t("Repository '{0}' registered with Argo CD successfully.", repoUrl));
        return true;
    } finally {
        tmpFile.dispose();
    }
}

// ---------------------------------------------------------------------------
// Helper: guide the user to create a fine-grained GitHub PAT for the
// specific private repo referenced in spec.source.repoURL, and copy it
// to the clipboard so they can paste it straight into Argo CD.
// ---------------------------------------------------------------------------

/**
 * Opens the GitHub fine-grained PAT creation page pre-filled with:
 *   - Token name: argocd-<repo>
 *   - Repository access: only this repo (via repository_ids[] when available)
 *   - Permissions: Contents = Read-only, Metadata = Read-only
 *
 * After the user generates the token on GitHub and pastes it back, the repo
 * is registered directly in Argo CD (argocd namespace repository Secret) so
 * that Settings → Repositories already shows the connected repo with the
 * supplied token — no manual paste required.
 */
async function guideGitHubPatForRepo(
    repoUrl: string,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
    clusterName: string,
): Promise<void> {
    if (!repoUrl) {
        vscode.window.showWarningMessage(l10n.t("No source repository URL found in the Application manifest."));
        return;
    }

    // Accept HTTPS and SSH URLs, optional .git suffix, optional trailing slash.
    const urlMatch = repoUrl.trim().match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?\s*$/i);
    if (!urlMatch) {
        vscode.window.showWarningMessage(
            l10n.t(
                "'{0}' is not a recognized GitHub repository URL. Use 'Register Repo Credentials' for non-GitHub or SSH repos.",
                repoUrl,
            ),
        );
        return;
    }
    const [, owner, repoSlug] = urlMatch;

    // Try to silently resolve the numeric repo ID (needed for programmatic PAT
    // creation and to pre-select the repo on the GitHub PAT creation page).
    let repoId: number | undefined;
    let repoIsPrivate: boolean | undefined;
    let sessionToken: string | undefined;
    try {
        const session = await vscode.authentication.getSession("github", ["repo"], {
            createIfNone: false,
            silent: true,
        });
        if (session) {
            sessionToken = session.accessToken;
            const res = await fetch(`https://api.github.com/repos/${owner}/${repoSlug}`, {
                headers: {
                    Authorization: `Bearer ${session.accessToken}`,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            });
            if (res.ok) {
                const data = (await res.json()) as { id: number; private: boolean };
                repoId = data.id;
                repoIsPrivate = data.private;
            }
        }
    } catch {
        // No session or API error — proceed without the repo ID.
    }

    if (repoIsPrivate === false) {
        vscode.window.showInformationMessage(
            l10n.t(
                "'{0}/{1}' is a public repository — Argo CD can pull from it without any credentials.",
                owner,
                repoSlug,
            ),
        );
        return;
    }

    // ------------------------------------------------------------------
    // Strategy 1: programmatic fine-grained PAT via GitHub REST API.
    //
    // POST /user/personal-access-tokens requires the caller's token to be a
    // **classic PAT** with the `manage_user:personal_access_tokens` scope.
    // A VS Code OAuth app token does NOT carry this scope, so this call will
    // silently return undefined in most cases.  It does work for users who
    // have already authenticated with a suitably scoped classic PAT.
    // ------------------------------------------------------------------
    if (sessionToken && repoId !== undefined) {
        const autoToken = await longRunning(
            l10n.t("Attempting to auto-generate a fine-grained PAT for '{0}/{1}'…", owner, repoSlug),
            () => generateGitHubRepoScopedPat(sessionToken!, repoId!, repoSlug),
        );

        if (autoToken) {
            const ok = await applyRepoSecret(kubectl, kubeConfigFile, repoUrl.trim(), {
                type: "git",
                url: repoUrl.trim(),
                username: "git",
                password: autoToken,
            });
            if (ok) await offerOpenArgoCDUI(kubectl, kubeConfigFile, clusterName);
            return;
        }
    }

    // ------------------------------------------------------------------
    // Strategy 2: guided manual flow — open the GitHub PAT creation page
    // pre-filled with the correct settings, then collect the pasted token.
    // ------------------------------------------------------------------
    const tokenName = `argocd-${repoSlug}`
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/-+$/g, "")
        .slice(0, 40);

    // GitHub accepts `description` and `repository_ids[]` as query params.
    const params = new URLSearchParams({ description: tokenName });
    if (repoId !== undefined) {
        params.append("repository_ids[]", String(repoId));
    }
    const patUrl = `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;

    const OPEN_GITHUB = l10n.t("Open GitHub \u2192");
    const repoNote = repoId !== undefined ? " (pre-selected)" : "";
    const patInstructions =
        `Create a fine-grained GitHub PAT so Argo CD can pull from '${owner}/${repoSlug}':\n\n` +
        `  \u2022 Token name: ${tokenName}  (pre-filled)\n` +
        `  \u2022 Expiration: 90 days (or custom)\n` +
        `  \u2022 Repository access: Only select '${owner}/${repoSlug}'${repoNote}\n` +
        `  \u2022 Permissions \u2192 Contents: Read-only\n` +
        `  \u2022 Permissions \u2192 Metadata: Read-only\n\n` +
        `Click 'Open GitHub \u2192', generate the token, then paste it into the next prompt.`;
    const action = await vscode.window.showInformationMessage(patInstructions, { modal: true }, OPEN_GITHUB);
    if (action !== OPEN_GITHUB) return;

    await vscode.env.openExternal(vscode.Uri.parse(patUrl));

    const token = await vscode.window.showInputBox({
        prompt: l10n.t("Paste the generated GitHub PAT"),
        password: true,
        placeHolder: "github_pat_\u2026",
        ignoreFocusOut: true,
        validateInput: (v) => (!v?.trim() ? l10n.t("Token is required.") : undefined),
    });
    if (!token) return;

    const ok = await applyRepoSecret(kubectl, kubeConfigFile, repoUrl.trim(), {
        type: "git",
        url: repoUrl.trim(),
        username: "git",
        password: token.trim(),
    });
    if (ok) await offerOpenArgoCDUI(kubectl, kubeConfigFile, clusterName);
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
        l10n.t("Apply Argo CD Application '{0}' to the current cluster context '{1}'?", appName, clusterName),
        { modal: true },
        APPLY,
    );
    if (!confirmed) return;

    // ------------------------------------------------------------------
    // 4. Write kubeconfig to a temp file.
    // ------------------------------------------------------------------
    const kubeConfigFile = await createTempFile(kubeconfigYaml, "yaml");

    try {
        // ------------------------------------------------------------------
        // 5. Verify Argo CD is installed (check for argocd namespace).
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
        // 6. Apply the manifest to the cluster.
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

        // Brief success toast (auto-dismisses).
        vscode.window.showInformationMessage(
            l10n.t(
                "✓ '{0}' applied to '{1}'. Use the action menu to open the UI or manage credentials.",
                appName,
                clusterName,
            ),
        );

        // ------------------------------------------------------------------
        // Persistent follow-up menu — loops until the user presses Esc so
        // all actions remain available even after performing one.
        // ------------------------------------------------------------------
        const repoUrl = doc.spec?.source?.repoURL ?? "";
        const isGitHub = /github\.com/i.test(repoUrl);

        interface ActionItem extends vscode.QuickPickItem {
            id: string;
        }
        const actionItems: ActionItem[] = [
            {
                label: "$(browser) Open Argo CD UI",
                description: l10n.t("Open the Argo CD dashboard in your browser"),
                id: "open_ui",
            },
            {
                label: "$(key) Get Argo CD Credentials",
                description: l10n.t("View / copy the initial admin password"),
                id: "get_creds",
            },
            ...(isGitHub
                ? [
                      {
                          label: "$(github) Generate GitHub Token for Repo",
                          description: l10n.t("Fine-grained PAT (Contents: read-only) for {0}", repoUrl),
                          id: "github_pat",
                      } as ActionItem,
                  ]
                : []),
            {
                label: "$(repo) Register Repo Credentials",
                description: l10n.t("Register Git repo auth with Argo CD (HTTPS / SSH / Bearer)"),
                id: "register_repo",
            },
            {
                label: "$(book) Sync Guide",
                description: l10n.t("Open Argo CD docs: sync the application"),
                id: "open_docs",
            },
        ];

        // Loop until the user presses Esc.
        while (true) {
            const pick = (await vscode.window.showQuickPick(actionItems, {
                title: l10n.t("Argo CD — '{0}' on '{1}' (Esc to close)", appName, clusterName),
                placeHolder: l10n.t("Select an action"),
                ignoreFocusOut: false,
            })) as ActionItem | undefined;

            if (!pick) break;

            if (pick.id === "open_ui") {
                await openArgoCDUI(kubectl, kubeConfigFile.filePath, clusterName);
            } else if (pick.id === "get_creds") {
                await showArgoCDCredentials(kubectl, kubeConfigFile.filePath);
            } else if (pick.id === "github_pat") {
                await guideGitHubPatForRepo(repoUrl, kubectl, kubeConfigFile.filePath, clusterName);
            } else if (pick.id === "register_repo") {
                await registerRepoCredentials(kubectl, kubeConfigFile.filePath, repoUrl, clusterName);
            } else if (pick.id === "open_docs") {
                await vscode.env.openExternal(
                    vscode.Uri.parse(
                        "https://argo-cd.readthedocs.io/en/stable/getting_started/#7-sync-deploy-the-application",
                    ),
                );
            }
        }
    } finally {
        kubeConfigFile.dispose();
    }
}
