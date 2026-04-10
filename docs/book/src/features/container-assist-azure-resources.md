# Azure Resources and Permissions

This page documents every Azure resource that Container Assist creates on your behalf, every role assignment it makes, and the Azure permissions you need to use the feature.

## Prerequisites: Azure Account Permissions

Container Assist operates across multiple resource groups and requires both resource management and role assignment permissions. This section explains which built-in roles work, which don't, and why.

### Which built-in roles work?

| Role | Scope | Sufficient? | Why |
|------|-------|-------------|-----|
| **Owner** | Subscription | **Yes** | Has full resource management and role assignment permissions. |
| **Contributor + User Access Administrator** | Subscription | **Yes** | Contributor handles resource creation; User Access Administrator handles role assignments. |
| **Contributor** (alone) | Subscription | **No** | Can create resource groups, managed identities, and federated credentials, but **cannot assign RBAC roles**. All role assignments will fail. |
| **Contributor** (alone) | Resource group | **No** | Cannot list clusters/ACRs across the subscription, cannot create the OIDC resource group, and cannot assign roles. |

> **Why Contributor alone is not enough:** The Contributor role explicitly excludes `Microsoft.Authorization/roleAssignments/write`. Container Assist assigns several RBAC roles across multiple resources (see [Role Assignments](#role-assignments) below). Without role assignment permissions, the OIDC setup completes partially -- the managed identity and federated credential are created, but the pipeline will fail at runtime because the identity lacks access to the cluster and ACR. The extension warns you which roles could not be assigned so you can request them from an admin.

### Why subscription-level access is needed

Container Assist touches up to 4 separate resource groups during a single run:

| Resource group | What happens there |
|---|---|
| **OIDC identity RG** (e.g. `rg-myapp-oidc`) | Created if it doesn't exist. Managed identity and federated credential are created here. |
| **AKS cluster RG** | AKS Cluster User Role, AKS RBAC Writer, and AKS RBAC Cluster Admin are assigned here (user namespace path). Cluster properties are read. |
| **ACR RG** | AcrPull, AcrPush, and ACR Tasks Contributor are assigned here. May be a different RG than the cluster. |
| **Node RG** (MC_*) | Kubelet identity is read from the cluster object (no direct operations). |

The extension also lists all AKS clusters and ACRs across the subscription during the selection wizard, which requires subscription-level read access (`Microsoft.Resources/subscriptions/resources/read`).

If your account is scoped to a single resource group, the cluster/ACR listing fails before you can even start.

### Detailed permission breakdown

For least-privilege or custom role setups, here are the specific permissions required:

| Permission | Why | When |
|---|---|---|
| `Microsoft.Authorization/roleAssignments/write` | Assign RBAC roles to managed identities and AKS kubelet identity | ACR attachment and OIDC setup |
| `Microsoft.ManagedIdentity/userAssignedIdentities/write` | Create managed identities | OIDC setup (if creating new identity) |
| `Microsoft.ManagedIdentity/userAssignedIdentities/read` | List/read existing managed identities | OIDC setup (if reusing identity) |
| `Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials/write` | Create OIDC federated credentials | OIDC setup |
| `Microsoft.Resources/subscriptions/resourceGroups/write` | Create resource groups | OIDC setup (if resource group does not exist) |
| `Microsoft.Resources/subscriptions/resources/read` | List resources across the subscription | Cluster and ACR selection wizard |
| `Microsoft.ContainerService/managedClusters/read` | Read AKS cluster properties | Cluster selection, Azure RBAC check |
| `Microsoft.ContainerRegistry/registries/read` | List and read ACR registries | ACR selection |
| `Microsoft.ContainerService/managedClusters/listClusterUserCredential/action` | List namespaces | Namespace selection |

These permissions must be granted at **subscription scope** (or across all relevant resource groups) for the full workflow to succeed.

## Azure Resources Created

Container Assist may create the following Azure resources during the OIDC setup flow. These resources appear in your Azure subscription and may incur governance or cost implications.

### Resource Group

| Attribute | Value |
|-----------|-------|
| **Resource type** | `Microsoft.Resources/resourceGroups` |
| **When created** | During OIDC setup, if the specified resource group does not already exist |
| **Default name** | `rg-<appName>-oidc` (user-editable) |
| **User consent** | Implicit -- you enter the resource group name, but are not separately prompted to confirm creation |

### User-Assigned Managed Identity

| Attribute | Value |
|-----------|-------|
| **Resource type** | `Microsoft.ManagedIdentity/userAssignedIdentities` |
| **When created** | During OIDC setup, if you choose "Create new managed identity" |
| **Default name** | `id-<appName>-github` (user-editable) |
| **Tags** | `purpose: "GitHub Actions OIDC"`, `createdBy: "AKS VS Code Extension"` |
| **User consent** | You explicitly choose "Create new" vs. "Use existing" before creation |

> **Note:** If you select "Use existing managed identity", no new identity is created. The selected identity is reused.

### Federated Identity Credential

| Attribute | Value |
|-----------|-------|
| **Resource type** | Federated Identity Credential on the managed identity |
| **When created** | During OIDC setup, automatically after identity is created or selected |
| **Credential name** | `GitHubActions` (fixed) |
| **Issuer** | `https://token.actions.githubusercontent.com` |
| **Subject** | `repo:<owner>/<repo>:ref:refs/heads/<branch>` |
| **Audiences** | `api://AzureADTokenExchange` |
| **User consent** | Automatic -- created as part of the OIDC setup progress after you initiate it |

The subject uses your repository's `owner/repo` from the git remote and the detected default branch (usually `main`).

## Role Assignments

Container Assist assigns Azure RBAC roles at two distinct stages: **ACR selection** (during the main wizard) and **OIDC setup** (when configuring the GitHub workflow pipeline). The principals and scopes differ between these stages.

### Stage 1: ACR Selection (Main Wizard)

When you select an Azure Container Registry that is not already attached to your AKS cluster, the extension offers to assign the **AcrPull** role:

| Role | Role Definition ID | Scope | Principal | Consent |
|------|--------------------|-------|-----------|---------|
| **AcrPull** | `7f951dda-4ed3-4680-a7ca-43fe172d538d` | ACR resource | AKS kubelet (agentpool) identity | **Prompted** -- you see a dialog with "Assign AcrPull Now" / "Dismiss" |

**Why:** This allows your AKS cluster to pull container images from the selected ACR at runtime. Without this, pod image pulls will fail with authentication errors.

**Principal:** The AKS cluster's kubelet identity (from `identityProfile.kubeletidentity`). For service-principal-based clusters, the service principal is used instead.

### Stage 2: OIDC Setup (GitHub Workflow Pipeline)

When you run the OIDC setup to configure GitHub Actions authentication, role assignments are created for the **OIDC managed identity** (the identity that your GitHub Actions workflow uses to authenticate with Azure). The roles assigned depend on whether you are deploying to a **user namespace** or a **managed namespace**.

#### User Namespace Path

For standard (non-managed) Kubernetes namespaces:

| # | Role | Role Definition ID | Scope | Purpose |
|---|------|--------------------|-------|---------|
| 1 | **Azure Kubernetes Service Cluster User Role** | `4abbcc35-e782-43d8-92c5-2d3f1bd2253f` | Resource group containing the AKS cluster | Allows the workflow to get cluster credentials (kubeconfig) |
| 2 | **AcrPush** | `8311e382-0749-4cb8-b61a-304f252e45ec` | ACR resource | Allows the workflow to push built container images to ACR |
| 3 | **Container Registry Tasks Contributor** | `fb382eab-e894-4461-af04-94435c366c3f` | ACR resource | Allows the workflow to run `az acr build` (cloud-based image builds) |
| 4 | **Azure Kubernetes Service RBAC Writer** | `a7ffa36f-339b-4b5c-8bdf-e2c188b2c0eb` | AKS cluster resource | Allows the workflow to deploy workloads to the cluster. **Only assigned if Azure RBAC is enabled on the cluster.** |
| 5 | **Azure Kubernetes Service RBAC Cluster Admin** | `b1ff04bb-8a4e-4dc4-8eb5-8693973ce19b` | AKS cluster resource | Allows the workflow to annotate namespace objects (cluster-scoped resources). **Only assigned if Azure RBAC is enabled on the cluster.** |

> **Note on roles #4 and #5:** The AKS RBAC Writer and AKS RBAC Cluster Admin roles are only assigned when the cluster has Azure RBAC enabled (`aadProfile.enableAzureRBAC`). If the cluster uses Kubernetes-native RBAC instead, these roles are skipped and you will need to create a Kubernetes `ClusterRoleBinding` or `RoleBinding` manually. The Cluster Admin role is specifically required because annotating a namespace (`kubectl annotate namespace`) requires patch access on the namespace resource and RBAC Writer role doesn't provide that.
#### Managed Namespace Path

For AKS managed namespaces, roles are scoped to the specific namespace rather than the entire cluster:

| # | Role | Role Definition ID | Scope | Purpose |
|---|------|--------------------|-------|---------|
| 1 | **Azure Kubernetes Service RBAC Writer** | `a7ffa36f-339b-4b5c-8bdf-e2c188b2c0eb` | Managed namespace | Kubernetes data-plane access (create/update deployments, services, configmaps, etc.) |
| 2 | **Azure Kubernetes Service Namespace Contributor** | `289d8817-ee69-43f1-a0af-43a45505b488` | Managed namespace | ARM-level access to fetch namespace-scoped kubeconfig |
| 3 | **AcrPush** | `8311e382-0749-4cb8-b61a-304f252e45ec` | ACR resource | Push container images to ACR |
| 4 | **Container Registry Tasks Contributor** | `fb382eab-e894-4461-af04-94435c366c3f` | ACR resource | Run `az acr build` for cloud-based image builds |
