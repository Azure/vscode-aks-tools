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
import { performArgoCDInstall, getOutputChannel } from "./argoCDInstall";

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
): Promise<void> {
    // 1. Confirm / enter the repository URL.
    const repoUrl = await vscode.window.showInputBox({
        prompt: l10n.t("Git repository URL to register with Argo CD"),
        value: defaultRepoUrl,
        ignoreFocusOut: true,
        validateInput: (v) => (!v || !v.trim() ? l10n.t("Repository URL is required.") : undefined),
    });
    if (!repoUrl) return;

    // 2. Choose authentication type.
    const authType = await vscode.window.showQuickPick(
        [
            {
                label: "$(lock) HTTPS",
                description: l10n.t("Username + personal access token or password"),
                id: "https",
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
        // --- HTTPS: username + token ---
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

    // 3. Build a valid Kubernetes Secret name from the repo URL.
    const secretName = `repo-${repoUrl
        .trim()
        .replace(/^https?:\/\/|^git@|\.git$/g, "")
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase()
        .replace(/^-+|-+$/g, "")
        .slice(0, 50)
        .replace(/-+$/g, "")}`;

    // 4. Serialize the secret object via js-yaml to avoid YAML injection.
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

    // 5. Apply via a temp file (never log credentials to channels).
    const tmpFile = await createTempFile(secretYaml, "yaml");
    try {
        const result = await longRunning(l10n.t("Registering repository credentials with Argo CD…"), () =>
            invokeKubectlCommand(kubectl, kubeConfigFile, `apply -f "${tmpFile.filePath}"`),
        );

        if (failed(result)) {
            vscode.window.showErrorMessage(l10n.t("Failed to register repository credentials: {0}", result.error));
            return;
        }

        vscode.window.showInformationMessage(
            l10n.t("Repository '{0}' registered with Argo CD successfully.", repoUrl.trim()),
        );
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
        const nsCheck = await longRunning(
            l10n.t("Checking if Argo CD is installed on '{0}'…", cluster.clusterName),
            () =>
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
                    "Argo CD does not appear to be installed on cluster '{0}' (namespace 'argocd' not found).\n\nInstall it now, or apply the manifest anyway.",
                    cluster.clusterName,
                ),
                { modal: true },
                INSTALL_NOW,
                APPLY_ANYWAY,
            );
            if (!choice) return;
            if (choice === INSTALL_NOW) {
                const channel = getOutputChannel();
                const installed = await performArgoCDInstall(
                    kubectl,
                    kubeConfigFile.filePath,
                    cluster.clusterName,
                    channel,
                );
                if (!installed) return;
            }
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

        const OPEN_UI = l10n.t("Open Argo CD UI");
        const GET_CREDS = l10n.t("Get Credentials");
        const REGISTER_REPO = l10n.t("Register Repo Credentials");
        const OPEN_DOCS = l10n.t("Sync Guide");
        const followUp = await vscode.window.showInformationMessage(
            l10n.t(
                "Argo CD Application '{0}' applied to cluster '{1}'.\n\n{2}\n\nArgo CD will begin syncing from the configured Git repository.",
                appName,
                cluster.clusterName,
                output,
            ),
            OPEN_UI,
            GET_CREDS,
            REGISTER_REPO,
            OPEN_DOCS,
        );

        if (followUp === OPEN_UI) {
            await openArgoCDUI(kubectl, kubeConfigFile.filePath, cluster.clusterName);
        } else if (followUp === GET_CREDS) {
            await showArgoCDCredentials(kubectl, kubeConfigFile.filePath);
        } else if (followUp === REGISTER_REPO) {
            await registerRepoCredentials(kubectl, kubeConfigFile.filePath, doc.spec?.source?.repoURL ?? "");
        } else if (followUp === OPEN_DOCS) {
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
