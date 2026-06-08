---
name: kickstart-predeploy
description: "Pre-deploy check playbook — verify cluster, ACR, permissions, and tooling before deployment."
disable-model-invocation: true
---

# Pre-Deploy Check

Ensure cluster, ACR, permissions, and tooling are all ready. Follow this strict order.

## 6a. Cluster Readiness

```bash
az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "provisioningState" --output tsv
```
- **Succeeded**: continue.
- **Creating**: `az aks wait --created --interval 30 --timeout 600`
- **Failed**: return to parent with `status: 'failed'`, `errorClass: 'cluster'`, and the activity-log message. The parent decides whether to retry, pick a different cluster, or escalate to the user.

## 6b. Cluster Metadata Detection

```bash
az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "{sku:sku.tier, azureRbac:aadProfile.enableAzureRBAC, localAccountsDisabled:disableLocalAccounts}" --output json
```
Record `isAutomatic`, `isAzureRbac`, `localAccountsDisabled` to gate subsequent checks.

## 6c. ACR Attachment

Do NOT assume the user is Owner. `--attach-acr` requires Owner/Account Admin/Co-Admin on the subscription. Try in order:
1. `az aks update --attach-acr` — works if user is Owner.
2. Direct role assignment (kubelet identity → AcrPull on ACR scope) — works if user has `roleAssignments/write`.
3. Admin hand-off — print the exact command, wait for confirmation, poll to verify.

## 6d. kubelogin

`which kubelogin` — if missing: `az aks install-cli`.
**Never use `--admin` credentials.** **Never suggest `az aks command invoke`** (same identity, same Forbidden).

## 6e. Control-Plane Probe

```bash
az aks get-credentials --resource-group <rg> --name <cluster> --overwrite-existing
kubectl auth can-i get namespaces
```
If fails → user needs **Azure Kubernetes Service Cluster User Role**. Halt and provide fix.

## 6f. Data-Plane RBAC Probes

```bash
kubectl auth can-i create deployments --namespace <namespace>
kubectl auth can-i create services --namespace <namespace>
kubectl auth can-i create configmaps --namespace <namespace>
```
If any return `no` → user needs **AKS RBAC Writer/Admin/Cluster Admin**.

**Self-remediation branching:**
- Probe: attempt `az role assignment create --role "Azure Kubernetes Service RBAC Cluster Admin"` for self.
- **Case A (succeeds):** Re-run `can-i` probes to confirm.
- **Case B (403):** Print admin hand-off block with exact commands. Wait for user confirmation, then poll `kubectl auth can-i create deployments` every 15s up to 3 min.

## 6g. ACR Push Pre-Check

User needs **AcrPush** + **Container Registry Tasks Contributor**. For new resources, self-assign. For existing, admin hand-off.

## Confirm

Use `vscode_askQuestions`: "Yes, deploy" (recommended), "Review artifacts first", "Not yet".
