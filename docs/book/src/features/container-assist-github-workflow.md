# GitHub Workflow and OIDC Setup

This page documents the GitHub Actions workflow that Container Assist generates, the OIDC setup process for Azure authentication, and the GitHub secrets that are configured.

## Generated Workflow Overview

Container Assist generates a GitHub Actions workflow file at `.github/workflows/<name>.yml` in your project. The workflow has two jobs:

1. **`buildImage`** -- Builds the container image and pushes it to Azure Container Registry
2. **`deploy`** -- Deploys the application to AKS using the generated Kubernetes manifests

The workflow uses **OIDC (OpenID Connect)** for passwordless authentication with Azure -- no long-lived secrets like client secrets or certificates are stored in GitHub.

## Workflow Template Variants

Two workflow templates exist, selected automatically based on your namespace type:

| Namespace Type | Template | Difference |
|----------------|----------|------------|
| **User namespace** (standard) | `aks-deploy.template.yaml` | Uses `azure/aks-set-context@v4` to get kubeconfig |
| **Managed namespace** | `aks-deploy-managed-ns.template.yaml` | Uses `az aks namespace get-credentials` + `kubelogin convert-kubeconfig` (managed namespaces are not yet supported by `aks-set-context`) |

## Workflow Configuration Values

The following values are injected into the workflow template. All deployment-specific values are inlined as workflow-level `env:` variables, not secrets:

| Value | Source |
|-------|--------|
| Workflow name | User-prompted during generation |
| Branch name | Hardcoded to `main` |
| Container name | Derived from primary module name or project folder name |
| Dockerfile path | Relative path from workspace root to the Dockerfile |
| Build context path | Relative path from workspace root to the build context directory |
| ACR name | Selected Azure Container Registry (short name) |
| ACR resource group | Resource group of the ACR |
| AKS cluster name | Selected AKS cluster |
| AKS cluster resource group | Resource group of the AKS cluster |
| K8s manifest paths | One or more manifest file paths |
| Namespace | Target Kubernetes namespace |

## Workflow Jobs and Steps

### Job: `buildImage`

| Step | Action / Command | Purpose |
|------|-----------------|---------|
| 1. Checkout | `actions/checkout@v4` | Clone the repository |
| 2. Azure login | `azure/login@v2` | OIDC login using `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` from GitHub secrets |
| 3. Log into ACR | `az acr login -n <ACR>` | Authenticate Docker to the Azure Container Registry |
| 4. Build and push image | `az acr build --image <ACR>.azurecr.io/<container>:<sha> --registry <ACR> -g <RG> -f <Dockerfile> <context>` | Cloud-build the image using ACR Tasks and push to ACR |

> **Note:** Images are built in the cloud using **ACR Tasks** (`az acr build`), not with a local Docker daemon. This is why the OIDC managed identity needs the **Container Registry Tasks Contributor** role in addition to **AcrPush**. See [Azure Resources and Permissions](./container-assist-azure-resources.md) for the full role assignment details.

### Job: `deploy` (depends on `buildImage`)

| Step | Action / Command | Purpose |
|------|-----------------|---------|
| 1. Checkout | `actions/checkout@v4` | Clone the repository |
| 2. Azure login | `azure/login@v2` | OIDC login (same as build job) |
| 3. Set up kubelogin | `azure/use-kubelogin@v1` | Install kubelogin for non-interactive Azure AD authentication |
| 4. Get K8s context | `azure/aks-set-context@v4` (user namespace) or `az aks namespace get-credentials` (managed namespace) | Fetch kubeconfig for the target cluster/namespace |
| 5. Deploy application | `Azure/k8s-deploy@v5` | Apply Kubernetes manifests with the built image |
| 6. Annotate namespace | `kubectl annotate namespace` | Set `aks-project/workload-identity-id` and `aks-project/workload-identity-tenant` |
| 7. Annotate deployment | `kubectl annotate deployment --all` | Set traceability annotations (see [Deployment Annotations](./container-assist-integration.md#deployment-annotations)) |

### GitHub Actions Permissions

Both jobs request these permissions:

| Permission | Value | Purpose |
|------------|-------|---------|
| `contents` | `read` | Read repository contents |
| `id-token` | `write` | **Required for OIDC** -- allows the workflow to request an Azure AD token via federated identity |
| `actions` | `read` | Read workflow run metadata (deploy job only) |

## GitHub Secrets

The workflow references three GitHub repository secrets for OIDC authentication:

| Secret Name | Value | Set By |
|-------------|-------|--------|
| `AZURE_CLIENT_ID` | Client ID of the OIDC managed identity | OIDC setup or manual |
| `AZURE_TENANT_ID` | Azure AD tenant ID | OIDC setup or manual |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | OIDC setup or manual |

These are **not** long-lived credentials. They are identifiers used together with the OIDC federated credential to obtain short-lived Azure AD tokens at workflow runtime.

## OIDC Setup Process

When a GitHub workflow is generated, Container Assist prompts you to configure OIDC authentication. This is the process that creates the Azure managed identity, federated credential, and sets the GitHub secrets.

### Step-by-Step Flow

#### Phase 1: Gather Information

1. **Detect GitHub repository** -- reads `git remote origin` URL and parses `owner/repo`. Detects the default branch from `refs/remotes/origin/HEAD`, falling back to checking for `origin/main` or `origin/master`.

2. **Prompt for Azure configuration:**
   - **Subscription** -- uses the subscription from the main wizard if available, otherwise prompts
   - **Resource group** -- input box, default: `rg-<appName>-oidc`
   - **Managed identity** -- choose "Create new" or "Use existing" (lists identities in the resource group)
     - If new: enter name (default: `id-<appName>-github`) and Azure region (default: `eastus`)

#### Phase 2: Azure Resource Creation

3. **Create or retrieve managed identity:**
   - If new: creates resource group (if needed), then creates managed identity with tags
   - If existing: retrieves the selected identity

4. **Assign role permissions:**
   - Roles differ by namespace type -- see [Azure Resources and Permissions](./container-assist-azure-resources.md#stage-2-oidc-setup-github-workflow-pipeline) for the complete list
   - Role assignments are idempotent (re-running OIDC setup will not create duplicate assignments)

5. **Create federated identity credential:**
   - Name: `GitHubActions`
   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:<owner>/<repo>:ref:refs/heads/<branch>`
   - Audiences: `api://AzureADTokenExchange`

#### Phase 3: Set GitHub Secrets

6. **Display results** with three options:
   - **"Set secrets"** -- authenticates with GitHub (requires `repo` scope), encrypts secrets using the repository's NaCl public key, and sets them via the GitHub API
   - **"Copy secrets and set manually"** -- copies all three secret key-value pairs to your clipboard
   - **"View Output"** -- logs the detailed summary to the VS Code output channel

### GitHub Authentication for Setting Secrets

When you choose "Set secrets", the extension:

1. Requests a GitHub session via `vscode.authentication.getSession("github", ["repo"])` -- you may see a GitHub OAuth consent prompt
2. Verifies repository access (checks you have push or admin permissions, and the repo is not archived)
3. Fetches the repository's public encryption key
4. Encrypts each secret value using NaCl sealed-box encryption (`libsodium-wrappers`)
5. Sets each secret via the GitHub Actions API (`createOrUpdateRepoSecret`)

> **GitHub SSO Note:** If your repository is in a GitHub organization that requires SAML SSO, the extension detects the `X-GitHub-SSO` response header and provides an authorization URL to complete SSO before retrying.

## Managed vs. User Namespace Differences

The namespace type affects multiple aspects of the generated workflow and OIDC configuration:

| Aspect | User Namespace | Managed Namespace |
|--------|---------------|-------------------|
| **Workflow template** | `aks-deploy.template.yaml` | `aks-deploy-managed-ns.template.yaml` |
| **Kubeconfig method** | `azure/aks-set-context@v4` action | `az aks namespace get-credentials` CLI command + `kubelogin convert-kubeconfig` |
| **Role scope for K8s access** | Cluster-level (conditional on Azure RBAC) | Namespace-level (always) |
| **AKS Namespace Contributor** | Not assigned | Assigned (needed for namespace-scoped kubeconfig) |
| **AKS Cluster User Role** | Assigned at resource group level | Not assigned |

See [Azure Resources and Permissions](./container-assist-azure-resources.md) for the complete role assignment matrix.

## Post-Generation Flow

After files are generated, the post-generation flow guides you through:

### 1. OIDC Setup Prompt

Shown only when a workflow was generated:

> "Your pipeline needs an Azure Managed Identity to connect to AKS..."

Options: **"Configure Pipeline with Managed Identity"** or **"Skip"**

### 2. Stage and Review

> "{N} files generated. Stage them and open Source Control to review?"

Options: **"Stage & Review"** or **"Open Files"**

- **Stage & Review:** Stages all generated files via the Git extension API, pre-fills a commit message (e.g., `"Add: Dockerfile, k8s manifests and GitHub Action workflow for myapp"`), and focuses the Source Control panel.
- **Open Files:** Opens all generated files in editor tabs, then offers staging.

### 3. Pull Request Creation

After you commit (from the SCM view, terminal, or any method), a one-time event listener detects the commit and offers:

> "Changes committed. Would you like to create a pull request?"

Options: **"Create Pull Request"** or **"Dismiss"**

PR creation requires the **GitHub Pull Requests** extension (`github.vscode-pull-request-github`). If not installed, the extension offers to install it.

The PR is created with:
- **Title:** `"feat: Add container and K8s deployment files for <appName>"`
- **Base branch:** configured via `aks.containerAssist.prDefaultBranch` (default: `main`)
- **Draft:** configured via `aks.containerAssist.prCreateAsDraft` (default: `true`)
- **Body:** Markdown template listing generated files with a description and next-steps checklist
