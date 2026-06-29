---
name: kickstart-acr-integration
description: "ACR integration for AKS Automatic — attaching the registry, image-reference conventions, and pull-secret-free authentication via the cluster's kubelet identity."
disable-model-invocation: true
---

# ACR Integration

AKS Automatic pulls images using the cluster's **kubelet managed identity**. The registry is "attached" by granting that identity `AcrPull` on the ACR resource — no `imagePullSecrets`, no docker registry secrets, no passwords stored in the cluster.

## Image reference conventions

- **Always reference images by `<registry>.azurecr.io/<repo>:<tag>`** — no Docker Hub fallback, no implicit `library/` prefix.
- **Pin tags.** Use a semver tag (`v1.2.3`) or a commit SHA. **Never `:latest`** (blocked by safeguards; AKS will refuse to schedule).
- **Prefer digest pinning for production manifests:** `myregistry.azurecr.io/orders-api@sha256:…`. `az acr build` and `docker buildx` both emit digests; capture them and substitute into the manifest before `kubectl apply`.
- **Never use `imagePullSecrets`.** If you see one being generated, stop — the kubelet identity should authenticate instead.

## Check whether the registry is already attached

When the cluster was provisioned via the Kickstart cluster-setup view, the registry is already attached. Verify before doing anything else:

```bash
KUBELET_ID=$(az aks show --name <cluster> --resource-group <rg> --subscription <sub> \
  --query "identityProfile.kubeletidentity.objectId" --output tsv)

ACR_SCOPE="/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ContainerRegistry/registries/<acr>"

az role assignment list --assignee "$KUBELET_ID" --role "AcrPull" --scope "$ACR_SCOPE" \
  --query "[].id" --output tsv
```

If that prints a role-assignment id, the registry is already attached — report "✓ Registry already attached" and skip the rest.

## Attaching the registry (idempotent)

Try in order — each fallback handles a tighter permission scope:

1. **`az aks update --attach-acr`** (requires Owner / User Access Administrator on the subscription):
   ```bash
   az aks update --name <cluster> --resource-group <rg> --subscription <sub> --attach-acr <acr>
   ```

2. **Direct role assignment** on just the ACR (only requires `Microsoft.Authorization/roleAssignments/write` at the registry scope):
   ```bash
   az role assignment create --assignee "$KUBELET_ID" --role "AcrPull" --scope "$ACR_SCOPE"
   ```

3. **PIM escalation** — if step 2 returns 403, follow `/kickstart-pim-activation` to surface PIM-eligible roles or generate an admin hand-off block.

## Pushing images to ACR

Use `az acr build` so the build happens server-side (no local Docker needed):

```bash
az acr build --registry <acr> --image <repo>:<tag> --file Dockerfile .
```

The caller needs `AcrPush` and `Container Registry Tasks Contributor` on the registry — both are probed by `aks.checkDeploymentPermissions` (see `/kickstart-handoff` step 6e–6g).

## Multi-region

For multi-region deployments, enable ACR geo-replication on a Premium SKU registry — the kubelet identity in each region still uses the same registry resource, so no extra role assignments are needed.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `ImagePullBackOff` / `401 Unauthorized` | Kubelet identity missing `AcrPull` | Re-run the attach step above |
| `ErrImagePull` with `manifest unknown` | Tag doesn't exist in the registry | Verify with `az acr repository show-tags --name <acr> --repository <repo>` |
| `az aks update --attach-acr` returns "Are you an Owner?" | User lacks subscription-scope role-assignment rights | Fall back to step 2 (direct role assignment on the registry scope) |
