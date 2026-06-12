---
name: kickstart-handoff
description: "Pre-deploy check playbook — verify cluster, ACR, permissions, and tooling before deployment."
disable-model-invocation: true
---

# Pre-Deploy Check

Ensure cluster, ACR, permissions, and tooling are all ready before deploying. Follow this strict order.

## 6a. Cluster Readiness

If already confirmed ready in a prior status check, skip. Otherwise:
```bash
az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "provisioningState" --output tsv
```
- **Succeeded**: continue.
- **Creating**: `az aks wait --name <cluster> --resource-group <rg> --subscription <sub> --created --interval 30 --timeout 600`
- **Failed**: offer retry or a different cluster via `vscode_askQuestions`.

## 6b. Cluster Metadata Detection

Record cluster properties to gate subsequent checks:
```bash
az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "{sku:sku.tier, azureRbac:aadProfile.enableAzureRBAC, localAccountsDisabled:disableLocalAccounts}" --output json
```
For existing clusters, use these flags to determine behavior. For new AKS Automatic clusters expect `sku=Automatic`, `azureRbac=true`, `localAccountsDisabled=true`.

## 6c. ACR Attachment

**First, check whether the registry is already attached** — when the cluster was created through the Kickstart cluster-setup view, it already granted the cluster's kubelet identity `AcrPull` on the registry, so this step is usually a no-op:

```bash
KUBELET_ID=$(az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "identityProfile.kubeletidentity.objectId" --output tsv)
az role assignment list --assignee "$KUBELET_ID" --role "AcrPull" --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ContainerRegistry/registries/<acr>" --query "[].id" --output tsv
```
If that prints a role-assignment id, the registry is already attached — report "✓ Registry already attached" and skip to 6d. Otherwise attach it now.

Do NOT assume the user is Owner. `az aks update --attach-acr` requires Owner/Account Admin/Co-Admin on the subscription. Try approaches in order:

1. `az aks update --name <cluster> --resource-group <rg> --attach-acr <acr> --subscription <sub>`
2. If that fails ("Are you an Owner on this subscription?"), assign the role directly (reuse `$KUBELET_ID` from the check above):
   ```bash
   az role assignment create --assignee "$KUBELET_ID" --role "AcrPull" --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ContainerRegistry/registries/<acr>"
   ```
3. If that also fails (403 — user lacks `roleAssignments/write`), follow `/kickstart-pim-activation` to check for PIM-eligible roles and guide activation. If none eligible, print an admin hand-off block with the exact `az role assignment create` command.

## 6d. kubelogin

AKS Automatic disables local accounts.
```bash
which kubelogin
```
If missing: `az aks install-cli`. If that fails: `brew install Azure/kubelogin/kubelogin` or https://github.com/Azure/kubelogin/releases.
**Never use `az aks get-credentials --admin`** (will fail). **Never suggest `az aks command invoke`** (same user identity, same Forbidden error).

## 6e. Control-Plane Probe

```bash
az aks get-credentials --resource-group <rg> --name <cluster> --overwrite-existing
kubectl auth can-i get namespaces
```
If `az aks get-credentials` fails, the user needs **Azure Kubernetes Service Cluster User Role** on the cluster. Halt and provide the fix.

## 6f. Data-Plane RBAC Probes

```bash
kubectl auth can-i create deployments --namespace <namespace>
kubectl auth can-i create services --namespace <namespace>
kubectl auth can-i create configmaps --namespace <namespace>
```
If any return `no`, the user needs one of: **AKS RBAC Writer**, **RBAC Admin**, or **RBAC Cluster Admin**.

**Self-remediation branching** — probe whether the user can self-assign:
```bash
USER_ID=$(az ad signed-in-user show --query id --output tsv)
az role assignment create --assignee "$USER_ID" --role "Azure Kubernetes Service RBAC Cluster Admin" --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ContainerService/managedClusters/<cluster>" 2>&1
```
- **Case A (succeeds):** Re-run the `can-i` probes to confirm.
- **Case B (403):** User cannot self-assign. Follow `/kickstart-pim-activation` to check for PIM-eligible roles. If eligible, guide activation then retry. If none, print an admin hand-off block with the exact command, wait for confirmation, then poll `kubectl auth can-i create deployments` every 15s (up to 3 min) until it returns `yes`.

## 6g. ACR Push Pre-Check

```bash
az acr build --registry <acr> --image kickstart-probe:probe --file /dev/null /dev/null 2>&1 | head -5
```
If forbidden, the user needs **AcrPush** + **Container Registry Tasks Contributor**. For new resources, self-assign (user is Owner). For existing, follow `/kickstart-pim-activation` to check for eligible roles and guide activation; if none, provide an admin hand-off.

## Confirm

Confirm readiness via `vscode_askQuestions`: "Yes, deploy" (recommended), "Review artifacts first", "Not yet".
