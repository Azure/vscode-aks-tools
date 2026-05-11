# Argo CD GitOps Integration

The Argo CD integration brings a complete GitOps workflow to AKS clusters directly inside VS Code. Argo CD must be **pre-installed** on your cluster — the extension checks for its presence and directs you to the [official docs](https://argo-cd.readthedocs.io/en/stable/getting_started/) if it is missing.

> **GitOps "Hollywood Principle"** — *Don't call us, we'll call you.*
> Your cluster never pushes. Argo CD continuously pulls desired state from a dedicated Git config repository and reconciles it automatically.

---

## Feature Flag

All Argo CD commands are gated behind a feature flag and **disabled by default**. To enable:

```json
{
  "aks.argoCDEnabled": true
}
```

Default value: `false`

After changing this setting, reload the VS Code window (`Developer: Reload Window`).

---

## Installation options

The VS Code commands below work with either install path. Pick whichever fits your environment.

| Option | Best for | How to install |
|---|---|---|
| **Azure-managed Argo CD extension** (recommended for production) | AKS or Azure Arc-enabled clusters that need Entra ID SSO, Workload Identity Federation to ACR / Azure DevOps, Azure Linux–hardened images, and opt-in automatic patch releases | `az k8s-extension create --extension-type Microsoft.ArgoCD …` — see the [Microsoft Learn tutorial](https://learn.microsoft.com/en-us/azure/azure-arc/kubernetes/tutorial-use-gitops-argocd) |
| **Upstream Argo CD** (manifests / Helm) | Dev clusters, custom builds, strict OSS parity, or non-Azure clusters | [Argo CD getting started](https://argo-cd.readthedocs.io/en/stable/getting_started/) |

The extension uses two independent runtime probes:

- **Install-method detection** — the `app.kubernetes.io/managed-by=Microsoft.ArgoCD` pod label in the `argocd` namespace. Resolves to `managed`, `upstream`, or `unknown` (e.g. RBAC forbidden, transient kubectl failure). The post-apply menu only surfaces the Azure **Workload Identity** hint when this resolves to `managed` (or when SSO is independently detected, see below).
- **Auth-mode detection** — the `argocd-cm` ConfigMap's `oidc.config` entry. When it references `login.microsoftonline.com`, the UI sign-in is treated as Entra ID **SSO** and the OSS admin-password flow is skipped.

These signals are orthogonal: a managed install can be configured without SSO, and — in principle — an upstream install can be wired to Entra ID by hand. The extension treats them as separate hints rather than collapsing them into one flag.

> **Public preview, Mar 2026.** The Azure-managed extension is in public preview on AKS and Azure Arc-enabled Kubernetes — see the [announcement blog](https://techcommunity.microsoft.com/blog/azurearcblog/announcing-public-preview-of-argo-cd-extension-on-aks-and-azure-arc-enabled-kube/4504497).

---

## Prerequisites

- A Kubernetes cluster with Argo CD installed via **either** of the [Installation options](#installation-options) above.
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
| **AKS: Argo CD Post-Deploy Actions** | Shown after a successful apply, or from the Command Palette | Open UI (SSO-aware), configure Azure Workload Identity (when source is ACR / Azure DevOps), connect a private GitHub repo, or open the Argo CD sync guide |

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

- If Argo CD is installed via the **Azure-managed extension** with Entra ID OIDC configured, the dialog prompts you to sign in with your Microsoft account — no admin password is fetched.
- If the `argocd-server` Service has a **LoadBalancer** with an external IP, the extension opens `https://<address>` directly.
- If the Service is **ClusterIP** (common for local setups), the extension starts a `kubectl port-forward` in an integrated terminal and shows an **Open Browser** button once the tunnel is ready.

### Configure Workload Identity for Azure (recommended)

Shown only when **both** conditions hold:

1. `spec.source.repoURL` of the applied Application points at an Azure source:
   - **ACR** hosts: `*.azurecr.io` (OCI Helm chart / manifest sources).
   - **Azure DevOps** hosts: `dev.azure.com/*`, legacy `*.visualstudio.com`, and the SSH variants `ssh.dev.azure.com` / `vs-ssh.visualstudio.com`.
2. The cluster is running the Azure-managed Argo CD extension (managed-by label detected) **or** Entra ID SSO is already configured on the `argocd-cm` ConfigMap.

The action opens the [Microsoft Learn tutorial](https://learn.microsoft.com/en-us/azure/azure-arc/kubernetes/tutorial-use-gitops-argocd) showing how to federate Argo CD's service account to your Azure identity, removing the need to store long-lived PATs or SSH keys as Kubernetes Secrets. Workload Identity Federation is the recommended credential path when running the Azure-managed Argo CD extension.

### Connect Private Repository (GitHub)

Shown only when the applied Application's `spec.source.repoURL` is a **private GitHub** repository:

- Pre-populates owner/repo from the YAML and (when a silent VS Code GitHub session exists) resolves the numeric repo ID.
- Opens the GitHub fine-grained PAT creation page with the token name and repository pre-filled.
- Prompts for the PAT in a masked input (never logged, never written to disk).
- Creates a labelled Kubernetes Secret (`argocd.argoproj.io/secret-type: repository`) via `kubectl create secret --from-literal` so Argo CD auto-discovers it without a restart.

For **Azure DevOps** or **ACR** sources, prefer the *Configure Workload Identity* action above instead of creating a PAT secret.

### Sync Guide

- Opens the Argo CD documentation for syncing applications.

---

## Check Argo CD Status

1. In the AKS cluster tree, right-click a cluster node.
2. Select **AKS: Check Argo CD Status**.
3. The **Argo CD** output channel shows:
   - Whether the `argocd` namespace exists.
   - Whether the **Azure-managed `Microsoft.ArgoCD` extension** is detected (via the `app.kubernetes.io/managed-by` pod label). Reported as `managed`, `upstream`, or `could not determine` when the label query fails (for example, due to RBAC).
   - Pod status (`kubectl get pods -n argocd -o wide`).
   - Service status (`kubectl get svc -n argocd`).
   - Tips for port-forwarding and authentication (SSO vs. initial admin password).

---

## Copilot Chat Integration

A GitHub Copilot chat skill is registered so you can ask questions like:

- *"How do I set up Argo CD on my AKS cluster?"*
- *"Create an Argo CD deployment for my cluster"*

The skill explains the GitOps principle and offers a button to launch the scaffold command directly from chat.

---

## Production topologies

The scaffolded `Application` manifests work unchanged with the upstream-parity features of the Azure-managed extension:

- **High availability (HA)** — chosen at install time via the managed extension or upstream Helm chart; no change required to the generated YAML.
- **Hub-and-spoke / multi-cluster** — the *Create Argo CD GitOps Pipeline* command prompts for a target cluster API server URL, which becomes `spec.destination.server` and can point at a remote spoke cluster from a central hub.
- **`ApplicationSet`** — the scaffolder currently emits a single `Application`. For generator-driven, multi-cluster rollouts (cluster generator, Git generator, etc.), hand-author an `ApplicationSet` alongside the generated `application.yaml`; the *Apply Argo CD Application to Cluster* command accepts any `argoproj.io/v1alpha1` resource.

---

## Security Notes

- **PATs and passwords** are never written to disk or logged to output channels. Repo credential Secrets are created via `kubectl create secret --from-literal` (in-memory only).
- **Workload Identity Federation** is preferred over PATs for ACR and Azure DevOps sources when running the Azure-managed extension — no long-lived credentials are stored on the cluster.
- **Entra ID SSO** replaces the OSS `argocd-initial-admin-secret` flow when the managed extension is configured with OIDC; the extension auto-detects this and skips the password prompt.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Argo CD is not installed on cluster" | Install Argo CD first — see [Installation options](#installation-options) |
| `az k8s-extension create` fails with `Microsoft.ArgoCD not found` | Register the `Microsoft.KubernetesConfiguration` resource provider and confirm region availability per the [Microsoft Learn tutorial](https://learn.microsoft.com/en-us/azure/azure-arc/kubernetes/tutorial-use-gitops-argocd) |
| `kubectl` not found | Ensure `kubectl` is on your PATH and the correct context is active |
| Port-forward fails | Check that no other process is using port 8080, or that the `argocd-server` Service exists |
| Admin-password Secret missing | Expected when the managed extension is configured with Entra ID SSO — sign in through the browser instead of entering a password |
| Want to avoid PATs for ACR or Azure DevOps | Configure **Workload Identity Federation** via the managed extension instead of using *Connect Private Repository* |
| Repo not syncing after credential registration | Verify the repo URL matches `spec.source.repoURL` exactly (including `.git` suffix if used) |
| Application CR not visible in Argo CD UI | Ensure the YAML has `namespace: argocd` in `metadata` — the Application CR must be in the Argo CD namespace |

---

## Further reading

- [Announcing public preview of the Argo CD extension on AKS and Azure Arc-enabled Kubernetes clusters](https://techcommunity.microsoft.com/blog/azurearcblog/announcing-public-preview-of-argo-cd-extension-on-aks-and-azure-arc-enabled-kube/4504497) — Azure Arc Blog, Mar 2026.
- [Microsoft Learn: Use GitOps with Argo CD on Azure Arc-enabled Kubernetes](https://learn.microsoft.com/en-us/azure/azure-arc/kubernetes/tutorial-use-gitops-argocd).
- [Argo CD upstream documentation](https://argo-cd.readthedocs.io/en/stable/).
