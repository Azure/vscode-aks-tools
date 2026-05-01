# Argo CD GitOps Integration

The Argo CD integration brings a complete GitOps workflow to AKS clusters directly inside VS Code. Argo CD must be **pre-installed** on your cluster — the extension checks for its presence and directs you to the [official docs](https://argo-cd.readthedocs.io/en/stable/getting_started/) if it is missing.

> **GitOps "Hollywood Principle"** — *Don't call us, we'll call you.*
> Your cluster never pushes. Argo CD continuously pulls desired state from a dedicated Git config repository and reconciles it automatically.

---

## Prerequisites

- An AKS cluster with Argo CD installed (via `kubectl`, Helm, or the `az k8s-extension` marketplace add-on).
- `kubectl` available on your PATH (the extension uses the active kubectl context).
- A **separate GitOps config repository** — Argo CD manifests should live apart from your application source code.

---

## Commands

The integration provides four commands, all prefixed with **AKS:**

| Command | Where it appears | Description |
|---------|-----------------|-------------|
| **AKS: Create Argo CD GitOps Pipeline** | Command Palette, Explorer folder context menu | Scaffold an annotated Argo CD Application manifest in a config repo |
| **AKS: Apply Argo CD Application to Cluster** | Explorer YAML file context menu, Editor context menu | Apply an Application YAML to the active cluster |
| **AKS: Check Argo CD Status** | AKS cluster tree right-click menu | Show Argo CD pod and service health in an output channel |
| **AKS: Argo CD Post-Deploy Actions** | Shown after a successful apply | Open UI, get credentials, register repo credentials, or view sync guide |

---

## Scaffold a GitOps Config Repository

1. Open the **Command Palette** (`Cmd+Shift+P` on macOS / `Ctrl+Shift+P` on Windows/Linux).
2. Run **AKS: Create Argo CD GitOps Pipeline**.
3. If you are inside an application source repository (detected by the presence of `Dockerfile`, `package.json`, `go.mod`, etc.), the extension warns you and offers to open a separate config repo folder instead.
4. Fill in the prompted parameters:
   - **App name** — validated as `[a-z0-9][a-z0-9-]*`.
   - **GitOps config repo URL** — enter manually, browse a local folder (reads `.git/config` origin automatically), or browse your GitHub repos (authenticates via VS Code's built-in GitHub provider).
   - **Source repo URL** (optional) — same picker options.
   - **Target cluster API server URL**.
   - **Target namespace** — where your workloads will be deployed.
   - **Container image** and **port**.
5. The extension scaffolds an `apps/<name>/` directory containing:
   - `application.yaml` — the Argo CD Application CR with all placeholders substituted.
   - `README.md` — step-by-step setup guide covering install, UI access, repo registration, day-2 workflow, and monitoring commands.
6. A notification offers quick-open buttons for the generated files.

---

## Apply an Application YAML to a Cluster

1. Open or right-click an Argo CD Application YAML file (`.yaml` / `.yml`).
2. Select **AKS: Apply Argo CD Application to Cluster**.
   - Alternatively, when you open an Application YAML, the extension detects it and shows an **"Apply to Cluster"** notification.
3. The extension:
   1. Validates the file is an `argoproj.io/v1alpha1 Application`.
   2. Resolves the active kubectl context (no subscription or cluster picker needed).
   3. Checks that Argo CD is installed (looks for the `argocd` namespace).
   4. Confirms the apply action.
   5. Runs `kubectl apply -n argocd -f <file>`.
4. After a successful apply, a notification offers four actions:

### Open Argo CD UI

- If the `argocd-server` Service has a **LoadBalancer** with an external IP, the extension opens `https://<address>` directly.
- If the Service is **ClusterIP** (common for local setups), the extension starts a `kubectl port-forward` in an integrated terminal and shows an **Open Browser** button once the tunnel is ready.

### Get Credentials

- Fetches the initial admin password from the `argocd-initial-admin-secret` Secret.
- Displays `Username: admin | Password: ••••••••` (masked).
- Offers **Copy Password** and **Reveal Password** buttons.
- If the secret has been rotated or deleted, shows an informational message.

### Register Repo Credentials (Private Repos)

- Pre-populates `spec.source.repoURL` from the applied Application YAML.
- Choose an auth type:
  - **HTTPS** — enter username + PAT/password (input is masked; credentials are never logged).
  - **SSH** — pick a private key file.
- Creates a labelled Kubernetes Secret (`argocd.argoproj.io/secret-type: repository`) directly via `kubectl` — credentials never touch disk as temp files.
- Argo CD picks up the Secret automatically without a restart.

### Sync Guide

- Opens the Argo CD documentation for syncing applications.

---

## Check Argo CD Status

1. In the AKS cluster tree, right-click a cluster node.
2. Select **AKS: Check Argo CD Status**.
3. The **Argo CD** output channel shows:
   - Whether the `argocd` namespace exists.
   - Pod status (`kubectl get pods -n argocd -o wide`).
   - Service status (`kubectl get svc -n argocd`).
   - Tips for port-forwarding and authentication.

---

## Copilot Chat Integration

A GitHub Copilot chat skill is registered so you can ask questions like:

- *"How do I set up Argo CD on my AKS cluster?"*
- *"Create an Argo CD deployment for my cluster"*

The skill explains the GitOps principle and offers a button to launch the scaffold command directly from chat.

---

## Security Notes

- **PAT / passwords** are never written to disk or logged to output channels. Repo credential Secrets are created via `kubectl create secret --from-literal`.
- **Admin password** is masked in all UI modals; only accessible via explicit Copy or Reveal actions.
- **SSH keys** are read from a user-selected file and passed directly to the Secret — never cached.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Argo CD is not installed on cluster" | Install Argo CD first: [Getting Started guide](https://argo-cd.readthedocs.io/en/stable/getting_started/) |
| `kubectl` not found | Ensure `kubectl` is on your PATH and the correct context is active |
| Port-forward fails | Check that no other process is using port 8080, or that the `argocd-server` Service exists |
| Repo not syncing after credential registration | Verify the repo URL matches `spec.source.repoURL` exactly (including `.git` suffix if used) |
| Application CR not visible in Argo CD UI | Ensure the YAML has `namespace: argocd` in `metadata` — the Application CR must be in the Argo CD namespace |
