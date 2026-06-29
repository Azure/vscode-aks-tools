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
- **Failed**: offer retry or a different cluster via `vscode/askQuestions`.

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

## 6e–6g. Permission Probes (preferred — single call)

Invoke the bundled VS Code command **`aks.checkDeploymentPermissions`** via `vscode/runCommand`. It runs all five remaining permission gates against the Azure ARM API (no `kubectl` / `az acr build` round-trip) and returns a self-contained markdown report you can render directly in chat.

**Args:**
```json
{
  "subscriptionId": "<sub>",
  "resourceGroup": "<rg>",
  "clusterName": "<cluster>",
  "acrName": "<acr>"
}
```

**Returns:**
```ts
{
  cancelled: boolean,
  allPassed?: boolean,
  scope?: { clusterScopeId, acrScopeId? },
  probes?: Array<{ id, label, status: "pass" | "fail" | "unknown", reason, recommendedRoles?, remediation? }>,
  markdown: string  // render verbatim
}
```

**Probes performed:**

| ID | Gate | Required role on fail |
|---|---|---|
| `cluster-user` | 6e — can download kubeconfig (`listClusterUserCredential`) | `Azure Kubernetes Service Cluster User Role` |
| `aks-dataplane-write` | 6f — can create K8s workloads on the cluster | `Azure Kubernetes Service RBAC Writer` |
| `acr-push` | 6g — user can push images to the ACR | `AcrPush` |
| `acr-tasks` | 6g — user can run `az acr build` server-side | `Container Registry Tasks Contributor` |
| `acr-pull-kubelet` | Cluster's kubelet identity can pull from the ACR | `AcrPull` |

**How to use the result:**

- If `allPassed === true`: render `markdown` and proceed to **Confirm**.
- For any failing probe, the included `remediation` is a ready-to-run `az role assignment create` command. Offer to run it.
- If `az role assignment create` then returns 403 (user lacks `Microsoft.Authorization/roleAssignments/write`), follow `/kickstart-pim-activation` — that skill calls `aks.checkRoleAssignmentPermissions` to surface PIM-eligible roles or generate an admin hand-off block.
- If `acrName` is omitted (no ACR in scope), the three ACR probes are skipped and the report says so.

**Fallback (only if the command is unavailable in this build):** fall back to the manual probes —
```bash
az aks get-credentials --resource-group <rg> --name <cluster> --overwrite-existing
kubectl auth can-i get namespaces
kubectl auth can-i create deployments --namespace <namespace>
az acr build --registry <acr> --image kickstart-probe:probe --file /dev/null /dev/null 2>&1 | head -5
```
With the same remediation roles as listed in the table above.

## Confirm

Confirm readiness via `vscode/askQuestions`: "Yes, deploy" (recommended), "Review artifacts first", "Not yet".
