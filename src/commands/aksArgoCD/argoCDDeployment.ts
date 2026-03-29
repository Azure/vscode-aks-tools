/**
 * Argo CD "Create Deployment" command.
 *
 * Argo CD follows the Hollywood Principle (GitOps / "don't call us, we'll call you"):
 * the cluster never pushes — Argo CD continuously PULLS desired state from a Git
 * repository and reconciles it against the live cluster.  This means the Argo CD
 * Application manifest must live in a **dedicated GitOps config repository**, NOT
 * in the same repository that contains your application source code.
 *
 * This command:
 *  1. Detects whether the current workspace looks like an application source repo
 *     and warns the user accordingly.
 *  2. Guides the user to either scaffold in place (config repo already open) or
 *     open a separate config repository folder.
 *  3. Collects the minimum required parameters through VS Code input boxes.
 *  4. Writes a fully-annotated Argo CD Application YAML under apps/<name>/.
 *
 * Reference: https://argo-cd.readthedocs.io/en/stable/
 */

import * as vscode from "vscode";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as l10n from "@vscode/l10n";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARGO_CD_DOCS_URL = "https://argo-cd.readthedocs.io/en/stable/";

/**
 * Well-known files/patterns that indicate the folder is an **application source**
 * repository rather than a dedicated GitOps config repository.
 */
const APP_SOURCE_INDICATORS: string[] = [
    "Dockerfile",
    "package.json",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Cargo.toml",
    "go.mod",
    "requirements.txt",
    "setup.py",
    "pyproject.toml",
    "*.csproj",
    "*.sln",
];

/**
 * Kubernetes manifest patterns that indicate existing cluster deployment files
 * are already present (strengthens the recommendation to use a separate repo).
 */
const DEPLOYMENT_MANIFEST_INDICATORS: string[] = [
    "**/deployment.yaml",
    "**/deployment.yml",
    "**/kustomization.yaml",
    "**/Chart.yaml",
];

// ---------------------------------------------------------------------------
// Argo CD Application YAML template
// ---------------------------------------------------------------------------

function buildArgoCDAppYaml(params: {
    appName: string;
    configRepoUrl: string;
    sourceRepoUrl: string;
    clusterServer: string;
    namespace: string;
    appPath: string;
}): string {
    return `# =============================================================================
# Argo CD Application Manifest
# =============================================================================
#
# ⚠️  IMPORTANT — Hollywood Principle / GitOps "Don't call us, we'll call you"
#
# This file belongs in a SEPARATE GitOps config repository, NOT in your
# application source repository.
#
# Argo CD watches this config repo and PULLS changes automatically to your
# AKS cluster.  It will detect drift between the live cluster state and what
# is declared here, and reconcile automatically.
#
# Recommended GitOps config repo layout:
#
#   config-repo/
#   └── apps/
#       └── ${params.appName}/
#           ├── application.yaml   ← this file
#           ├── deployment.yaml    ← your Kubernetes workload manifests
#           └── service.yaml
#
# Reference: https://argo-cd.readthedocs.io/en/stable/
# =============================================================================

apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  # The name used inside Argo CD to identify this application.
  name: ${params.appName}

  # Argo CD system namespace — do NOT change unless you installed Argo CD
  # in a custom namespace.
  namespace: argocd

  labels:
    app.kubernetes.io/name: ${params.appName}
    app.kubernetes.io/managed-by: argocd

  annotations:
    # URL of the *application source* repository (informational).
    # Keep this separate from repoURL below which points to THIS config repo.
    aks-extension/source-repo: "${params.sourceRepoUrl}"

    # Link to Argo CD docs for reference.
    aks-extension/docs: "https://argo-cd.readthedocs.io/en/stable/"

spec:
  # Argo CD project — "default" works for most setups.
  # See: https://argo-cd.readthedocs.io/en/stable/user-guide/projects/
  project: default

  source:
    # ✅ This is the URL of THIS GitOps config repository.
    #    It is NOT the application source repository.
    repoURL: ${params.configRepoUrl}

    # Branch / tag / commit SHA to track.
    targetRevision: HEAD

    # Path inside this repo that contains the Kubernetes manifests for this app.
    path: ${params.appPath}

  destination:
    # AKS cluster API server URL.
    # Use "https://kubernetes.default.svc" when Argo CD runs inside the same cluster.
    # For an external AKS cluster, use the API server URL from kubeconfig.
    server: ${params.clusterServer}

    # Kubernetes namespace to deploy resources into.
    namespace: ${params.namespace}

  syncPolicy:
    automated:
      # Remove resources from the cluster when they are deleted from Git.
      prune: true

      # Automatically bring the cluster back in sync when it drifts from Git.
      selfHeal: true

    syncOptions:
      # Create the target namespace automatically if it does not exist.
      - CreateNamespace=true

      # Validate manifests against the Kubernetes API schema before applying.
      - Validate=true

    # Retry failed sync operations with exponential back-off.
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
`;
}

// ---------------------------------------------------------------------------
// Kubernetes Deployment YAML template
// ---------------------------------------------------------------------------

function buildDeploymentYaml(params: {
    appName: string;
    namespace: string;
    containerImage: string;
    containerPort: number;
}): string {
    return `# =============================================================================
# Kubernetes Deployment manifest
# =============================================================================
#
# This file is managed by Argo CD (GitOps).
#
# ⚠️  Do NOT apply this file manually with kubectl unless you intentionally
# want to create a temporary drift that Argo CD will immediately reconcile.
#
# Edit here → commit to this GitOps config repo → Argo CD detects the change
# and rolls it out to the AKS cluster automatically.
#
# =============================================================================

apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${params.appName}
  namespace: ${params.namespace}
  labels:
    app: ${params.appName}
    app.kubernetes.io/name: ${params.appName}
    app.kubernetes.io/managed-by: argocd
spec:
  # Number of pod replicas — increase for high availability.
  replicas: 2

  selector:
    matchLabels:
      app: ${params.appName}

  template:
    metadata:
      labels:
        app: ${params.appName}
        app.kubernetes.io/name: ${params.appName}
    spec:
      # -----------------------------------------------------------------------
      # Security context: run as non-root by default.
      # Adjust or remove if your container requires root.
      # -----------------------------------------------------------------------
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault

      containers:
        - name: ${params.appName}
          # Replace this with your actual container image.
          # Argo CD will roll out a new version whenever this tag changes in Git.
          image: ${params.containerImage}
          imagePullPolicy: Always

          ports:
            - name: http
              containerPort: ${params.containerPort}
              protocol: TCP

          # Least-privilege container security settings.
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL

          # ----------------------------------------------------------------
          # Resource limits — tune to your workload.
          # ----------------------------------------------------------------
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"

          # ----------------------------------------------------------------
          # Probes — adjust paths / commands to match your application.
          # ----------------------------------------------------------------
          readinessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5

          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
`;
}

// ---------------------------------------------------------------------------
// Kubernetes Service YAML template
// ---------------------------------------------------------------------------

function buildServiceYaml(params: { appName: string; namespace: string; containerPort: number }): string {
    return `# =============================================================================
# Kubernetes Service manifest
# =============================================================================
#
# This file is managed by Argo CD (GitOps).
# Edit here → commit → Argo CD reconciles the change to the AKS cluster.
#
# =============================================================================

apiVersion: v1
kind: Service
metadata:
  name: ${params.appName}
  namespace: ${params.namespace}
  labels:
    app: ${params.appName}
    app.kubernetes.io/name: ${params.appName}
    app.kubernetes.io/managed-by: argocd
spec:
  # ClusterIP   — internal cluster traffic only (default, most secure).
  # LoadBalancer — expose directly via Azure Load Balancer (public IP).
  # NodePort    — expose on a node port (rarely used with AKS).
  #
  # Change to LoadBalancer if you need external access.
  type: ClusterIP

  selector:
    app: ${params.appName}

  ports:
    - name: http
      protocol: TCP
      # External port clients connect to.
      port: 80
      # Must match containerPort in deployment.yaml.
      targetPort: ${params.containerPort}
`;
}

// ---------------------------------------------------------------------------
// README template
// ---------------------------------------------------------------------------

function buildReadmeMarkdown(params: {
    appName: string;
    namespace: string;
    configRepoUrl: string;
    sourceRepoUrl: string;
    clusterServer: string;
    containerImage: string;
    containerPort: number;
    appPath: string;
}): string {
    const sourceRepoLine = params.sourceRepoUrl
        ? `- **Application source repo**: ${params.sourceRepoUrl}`
        : `- **Application source repo**: *(not specified)*`;

    return `# Argo CD GitOps Config — \`${params.appName}\`

> Generated by the **AKS VS Code Extension** — Argo CD integration.
> Reference: <https://argo-cd.readthedocs.io/en/stable/>

---

## 📌 The Hollywood Principle (GitOps)

Argo CD follows the **"Don't call us, we'll call you"** (Hollywood) principle of computer science.
Your AKS cluster **never pushes** changes — Argo CD runs as a controller inside the cluster and
continuously **PULLS** the desired state from this Git repository, then reconciles live resources
to match what is declared here.

\`\`\`
  ┌─────────────────────────┐        git pull / watch
  │  This GitOps config repo │ ◄──────────────────────── Argo CD controller
  │  (desired state in Git)  │                            (inside AKS cluster)
  └─────────────────────────┘
                                      kubectl apply (by Argo CD)
                                ────────────────────────────►
                                                          ┌──────────┐
                                                          │ AKS live │
                                                          │ cluster  │
                                                          └──────────┘
\`\`\`

> ⚠️ **This config repo MUST be separate from your application source repo.**
> Mixing Argo CD manifests with application source code breaks the GitOps separation of concerns.

---

## 📂 This directory

\`\`\`
${params.appPath}/
├── README.md            ← you are here
├── application.yaml     ← Argo CD Application CR (tells Argo CD what to watch)
├── deployment.yaml      ← Kubernetes Deployment (your workload)
└── service.yaml         ← Kubernetes Service (network exposure)
\`\`\`

| File | Purpose |
|------|---------|
| \`application.yaml\` | Registers this app with Argo CD. Points at this config repo path. |
| \`deployment.yaml\` | Describes your container workload, replicas, probes, resource limits. |
| \`service.yaml\` | Exposes the workload inside (or outside) the cluster. |

---

## ⚙️ Configuration summary

| Parameter | Value |
|-----------|-------|
| App name | \`${params.appName}\` |
| Config repo (this repo) | ${params.configRepoUrl} |
| ${sourceRepoLine} |
| Target cluster | \`${params.clusterServer}\` |
| Target namespace | \`${params.namespace}\` |
| Container image | \`${params.containerImage}\` |
| Container port | \`${params.containerPort}\` |

---

## 🚀 Step 1 — Install Argo CD on your AKS cluster

Argo CD runs as a set of Kubernetes controllers inside a dedicated namespace (\`argocd\`).

### Option A — kubectl (official install)

\`\`\`bash
# 1. Create the argocd namespace
kubectl create namespace argocd

# 2. Apply the official install manifest
#    Check https://github.com/argoproj/argo-cd/releases for the latest version
kubectl apply -n argocd \\
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# 3. Wait for all pods to become ready
kubectl -n argocd rollout status deploy/argocd-server
kubectl -n argocd get pods
\`\`\`

### Option B — Helm chart

\`\`\`bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

helm install argocd argo/argo-cd \\
  --namespace argocd \\
  --create-namespace \\
  --set server.service.type=LoadBalancer
\`\`\`

> **AKS tip**: For production, use **Azure Workload Identity** for Argo CD instead of storing
> Git credentials as Kubernetes Secrets.
> See: <https://argo-cd.readthedocs.io/en/stable/operator-manual/security/>

---

## 🔑 Step 2 — Access the Argo CD UI & CLI

\`\`\`bash
# Get the initial admin password
argocd admin initial-password -n argocd

# Port-forward to access the UI locally
kubectl -n argocd port-forward svc/argocd-server 8080:443
# Open: https://localhost:8080  (accept the self-signed cert)

# Log in via CLI
argocd login localhost:8080 --username admin --insecure
\`\`\`

---

## 🔗 Step 3 — Connect this config repo to Argo CD

\`\`\`bash
# Register the GitOps config repo
# For private repos add --ssh-private-key-path or --username / --password
argocd repo add ${params.configRepoUrl}
\`\`\`

---

## 📋 Step 4 — Register this application with Argo CD

\`\`\`bash
# Option A: from the generated application.yaml (recommended — keeps config in Git)
argocd app create -f ${params.appPath}/application.yaml

# Option B: CLI flags (useful for one-off testing)
argocd app create ${params.appName} \\
  --repo ${params.configRepoUrl} \\
  --path ${params.appPath} \\
  --dest-server ${params.clusterServer} \\
  --dest-namespace ${params.namespace} \\
  --sync-policy automated \\
  --auto-prune \\
  --self-heal
\`\`\`

---

## 🔄 Step 5 — Day-2: making changes

Because Argo CD follows the Hollywood Principle, **you never \`kubectl apply\` directly in production**.
The workflow is always:

\`\`\`
1.  Edit a file in this repo  (e.g. bump the image tag in deployment.yaml)
2.  git commit -m 'chore: bump ${params.appName} image to v1.2.3'
3.  git push
4.  Argo CD detects the change (default poll: 3 min, or via webhook — see below)
5.  Argo CD applies the diff to the AKS cluster automatically
\`\`\`

### Set up a Git webhook for instant sync (optional but recommended)

\`\`\`bash
# Get the Argo CD server external address
kubectl -n argocd get svc argocd-server

# In GitHub → repo Settings → Webhooks → Add webhook:
#   Payload URL : https://<argocd-server>/api/webhook
#   Content type: application/json
#   Secret      : (configure in argocd-secret, key: webhook.github.secret)
\`\`\`

---

## 🩺 Step 6 — Monitor & troubleshoot

\`\`\`bash
# Overall app status
argocd app get ${params.appName}

# List all managed apps
argocd app list

# Diff Git desired state vs live cluster state
argocd app diff ${params.appName}

# Force a manual sync (use sparingly — normally let Argo CD do it)
argocd app sync ${params.appName}

# List live Kubernetes resources owned by this app
argocd app resources ${params.appName}

# View recent sync history
argocd app history ${params.appName}
\`\`\`

---

## 📚 Further reading

| Resource | URL |
|----------|-----|
| Argo CD docs | <https://argo-cd.readthedocs.io/en/stable/> |
| Getting started | <https://argo-cd.readthedocs.io/en/stable/getting_started/> |
| App of Apps pattern | <https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/> |
| Sync waves (ordering) | <https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/> |
| Azure Workload Identity | <https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview> |
| Notifications | <https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/> |
`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if any well-known application source file is found in the
 * given workspace folder (depth-limited for performance).
 */
async function detectApplicationSourceRepo(folderUri: vscode.Uri): Promise<boolean> {
    for (const indicator of APP_SOURCE_INDICATORS) {
        try {
            const matches = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folderUri.fsPath, indicator),
                null,
                1,
            );
            if (matches.length > 0) return true;
        } catch {
            // ignore filesystem errors on individual patterns
        }
    }
    return false;
}

/**
 * Returns true if the workspace contains existing Kubernetes deployment manifests.
 */
async function detectExistingDeploymentManifests(folderUri: vscode.Uri): Promise<boolean> {
    for (const pattern of DEPLOYMENT_MANIFEST_INDICATORS) {
        try {
            const matches = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folderUri.fsPath, pattern),
                "**/node_modules/**",
                1,
            );
            if (matches.length > 0) return true;
        } catch {
            // ignore
        }
    }
    return false;
}

/**
 * Prompts for a required, single-line string.  Returns undefined if the user
 * cancels or leaves the field blank.
 */
async function promptRequired(
    prompt: string,
    placeHolder: string,
    value?: string,
    validate?: (v: string) => string | undefined,
): Promise<string | undefined> {
    return vscode.window.showInputBox({
        prompt,
        placeHolder,
        value,
        ignoreFocusOut: true,
        validateInput: (v) => {
            if (!v || v.trim() === "") return l10n.t("This field is required.");
            return validate ? validate(v.trim()) : undefined;
        },
    });
}

// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

export async function draftArgoCDDeployment(_context: IActionContext, target: unknown): Promise<void> {
    // -----------------------------------------------------------------------
    // 1. Resolve the workspace folder the command was invoked from.
    // -----------------------------------------------------------------------
    let workspaceFolder: vscode.WorkspaceFolder | undefined;

    if (target instanceof vscode.Uri) {
        workspaceFolder = vscode.workspace.getWorkspaceFolder(target);
    }

    if (!workspaceFolder) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showErrorMessage(
                l10n.t("You must have a workspace open to create an Argo CD deployment manifest."),
            );
            return;
        }

        workspaceFolder =
            folders.length === 1
                ? folders[0]
                : await vscode.window.showWorkspaceFolderPick({
                      placeHolder: l10n.t("Select the workspace folder to scaffold the Argo CD config into."),
                  });

        if (!workspaceFolder) return;
    }

    // -----------------------------------------------------------------------
    // 2. Analyse the workspace to tailor the guidance message.
    // -----------------------------------------------------------------------
    const [looksLikeAppRepo, hasDeploymentFiles] = await Promise.all([
        detectApplicationSourceRepo(workspaceFolder.uri),
        detectExistingDeploymentManifests(workspaceFolder.uri),
    ]);

    // -----------------------------------------------------------------------
    // 3. Show the Hollywood-Principle guidance message (always shown).
    // -----------------------------------------------------------------------
    const warningParts: string[] = [
        l10n.t("Argo CD — Hollywood Principle (GitOps)"),
        "",
        l10n.t("Argo CD follows the \"Don't call us, we'll call you\" (Hollywood) principle."),
        l10n.t(
            "Your AKS cluster does NOT push changes — Argo CD continuously PULLS desired state from a Git repository and reconciles it automatically.",
        ),
        "",
        l10n.t(
            "This means your Argo CD Application manifest MUST live in a dedicated GitOps config repository, separate from your application source code.",
        ),
    ];

    if (looksLikeAppRepo) {
        warningParts.push(
            "",
            l10n.t(
                "⚠  This workspace appears to be an APPLICATION SOURCE repository (source files / Dockerfile detected).",
            ),
            l10n.t(
                "It is strongly recommended to add Argo CD manifests to a SEPARATE GitOps config repository instead.",
            ),
        );
    }

    if (hasDeploymentFiles) {
        warningParts.push(
            "",
            l10n.t("⚠  Existing Kubernetes deployment manifests were detected in this workspace."),
            l10n.t(
                "If those belong to your application, please open your dedicated GitOps config repository before scaffolding.",
            ),
        );
    }

    warningParts.push(
        "",
        l10n.t("Recommended GitOps config repo layout (4 files will be scaffolded):"),
        l10n.t("  config-repo/"),
        l10n.t("  └── apps/<app-name>/"),
        l10n.t("      ├── README.md         ← install guide + how it all fits together"),
        l10n.t("      ├── application.yaml  ← Argo CD Application CR"),
        l10n.t("      ├── deployment.yaml   ← Kubernetes Deployment"),
        l10n.t("      └── service.yaml      ← Kubernetes Service"),
        "",
        l10n.t("How would you like to proceed?"),
    );

    const SCAFFOLD_HERE = l10n.t("Scaffold Here");
    const OPEN_CONFIG_REPO = l10n.t("Open Config Repository…");
    const LEARN_MORE = l10n.t("Learn More");

    const choice = await vscode.window.showWarningMessage(
        warningParts.join("\n"),
        { modal: true },
        SCAFFOLD_HERE,
        OPEN_CONFIG_REPO,
        LEARN_MORE,
    );

    if (!choice) return; // dismissed

    if (choice === LEARN_MORE) {
        await vscode.env.openExternal(vscode.Uri.parse(ARGO_CD_DOCS_URL));
        return;
    }

    // -----------------------------------------------------------------------
    // 4. Determine the target folder (current workspace or user-selected).
    // -----------------------------------------------------------------------
    let targetFolderUri = workspaceFolder.uri;

    if (choice === OPEN_CONFIG_REPO) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: l10n.t("Select GitOps Config Repository Folder"),
            title: l10n.t("Open Argo CD GitOps Config Repository"),
        });
        if (!picked || picked.length === 0) return;
        targetFolderUri = picked[0];
    }

    // -----------------------------------------------------------------------
    // 5. Collect parameters via input boxes.
    // -----------------------------------------------------------------------
    const appName = await promptRequired(
        l10n.t("Application name (used as Argo CD app name and directory name)"),
        "my-app",
        undefined,
        (v) =>
            /^[a-z0-9][a-z0-9-]*$/.test(v)
                ? undefined
                : l10n.t("Use lowercase letters, digits, and hyphens only (must start with a letter or digit)."),
    );
    if (!appName) return;

    const configRepoUrl = await promptRequired(
        l10n.t("GitOps config repository URL (this is the Git repo Argo CD will watch)"),
        "https://github.com/my-org/my-app-config",
    );
    if (!configRepoUrl) return;

    // Source repo is informational — allow empty.
    const sourceRepoUrl =
        (await vscode.window.showInputBox({
            prompt: l10n.t("Application source repository URL (optional — stored as an annotation for traceability)"),
            placeHolder: "https://github.com/my-org/my-app",
            ignoreFocusOut: true,
        })) ?? "";

    const clusterServer = await promptRequired(
        l10n.t("Target AKS cluster API server URL (use https://kubernetes.default.svc for in-cluster)"),
        "https://kubernetes.default.svc",
        "https://kubernetes.default.svc",
    );
    if (!clusterServer) return;

    const namespace = await promptRequired(l10n.t("Target Kubernetes namespace"), "default", "default", (v) =>
        /^[a-z0-9][a-z0-9-]*$/.test(v)
            ? undefined
            : l10n.t("Use lowercase letters, digits, and hyphens only (must start with a letter or digit)."),
    );
    if (!namespace) return;

    const containerImage = await promptRequired(
        l10n.t("Container image for deployment.yaml (e.g. myregistry.azurecr.io/my-app:latest)"),
        `myregistry.azurecr.io/${appName}:latest`,
        `myregistry.azurecr.io/${appName}:latest`,
    );
    if (!containerImage) return;

    const containerPortRaw = await promptRequired(
        l10n.t("Container port your application listens on"),
        "8080",
        "8080",
        (v) => {
            const n = Number(v);
            return Number.isInteger(n) && n > 0 && n <= 65535
                ? undefined
                : l10n.t("Enter a valid TCP port number (1–65535).");
        },
    );
    if (!containerPortRaw) return;
    const containerPort = Number(containerPortRaw);

    // -----------------------------------------------------------------------
    // 6. Write all four GitOps config files.
    // -----------------------------------------------------------------------
    const appPath = `apps/${appName}`;
    const appDirUri = vscode.Uri.joinPath(targetFolderUri, appPath);

    const readmeUri = vscode.Uri.joinPath(appDirUri, "README.md");
    const applicationYamlUri = vscode.Uri.joinPath(appDirUri, "application.yaml");
    const deploymentYamlUri = vscode.Uri.joinPath(appDirUri, "deployment.yaml");
    const serviceYamlUri = vscode.Uri.joinPath(appDirUri, "service.yaml");

    const applicationYaml = buildArgoCDAppYaml({
        appName,
        configRepoUrl,
        sourceRepoUrl,
        clusterServer,
        namespace,
        appPath,
    });

    const deploymentYaml = buildDeploymentYaml({ appName, namespace, containerImage, containerPort });
    const serviceYaml = buildServiceYaml({ appName, namespace, containerPort });
    const readmeMarkdown = buildReadmeMarkdown({
        appName,
        namespace,
        configRepoUrl,
        sourceRepoUrl,
        clusterServer,
        containerImage,
        containerPort,
        appPath,
    });

    try {
        await vscode.workspace.fs.createDirectory(appDirUri);

        await Promise.all([
            vscode.workspace.fs.writeFile(readmeUri, Buffer.from(readmeMarkdown, "utf8")),
            vscode.workspace.fs.writeFile(applicationYamlUri, Buffer.from(applicationYaml, "utf8")),
            vscode.workspace.fs.writeFile(deploymentYamlUri, Buffer.from(deploymentYaml, "utf8")),
            vscode.workspace.fs.writeFile(serviceYamlUri, Buffer.from(serviceYaml, "utf8")),
        ]);

        // Open README.md first so the user sees the setup guide immediately;
        // the YAML files are visible alongside it in the explorer tree.
        await vscode.window.showTextDocument(readmeUri);

        const VIEW_README = l10n.t("Open README.md");
        const VIEW_DEPLOYMENT = l10n.t("Open deployment.yaml");
        const VIEW_SERVICE = l10n.t("Open service.yaml");

        const followUp = await vscode.window.showInformationMessage(
            l10n.t(
                "Argo CD config scaffolded at {0}/ — 4 files created: README.md, application.yaml, deployment.yaml, service.yaml.\n\nNext steps:\n  1. Review and customise each file.\n  2. git add {0}/ && git commit -m 'feat: argo cd config for {1}'\n  3. argocd app create -f {0}/application.yaml",
                appPath,
                appName,
            ),
            VIEW_README,
            VIEW_DEPLOYMENT,
            VIEW_SERVICE,
        );

        if (followUp === VIEW_README) {
            await vscode.window.showTextDocument(readmeUri);
        } else if (followUp === VIEW_DEPLOYMENT) {
            await vscode.window.showTextDocument(deploymentYamlUri);
        } else if (followUp === VIEW_SERVICE) {
            await vscode.window.showTextDocument(serviceYamlUri);
        }
    } catch (err) {
        vscode.window.showErrorMessage(l10n.t("Failed to create Argo CD config files: {0}", String(err)));
    }
}
