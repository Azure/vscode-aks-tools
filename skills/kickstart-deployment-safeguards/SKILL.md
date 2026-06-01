---
name: kickstart-deployment-safeguards
description: "Deployment safeguards are the built-in Azure Policy assignments enforced by AKS Automatic. Teaches each rule and severity and how to author manifests that satisfy them (single source of truth: safeguards.json)."
disable-model-invocation: true
---

# AKS Security

## Pod security standards

AKS Automatic enforces the **Restricted** pod security standard in all namespaces by default.

Prohibited settings:
- `securityContext.privileged: true`
- `securityContext.allowPrivilegeEscalation: true`
- `hostPath` volumes
- `hostNetwork: true`
- `hostPID: true`

Required settings:
- `securityContext.runAsNonRoot: true`
- `securityContext.seccompProfile.type: RuntimeDefault`
- `securityContext.capabilities.drop: ["ALL"]`
- `resources.limits` on all containers

## Workload identity

Use **Azure Workload Identity** for all Azure service access. Never mount Azure credentials as secrets.

```yaml
metadata:
  labels:
    azure.workload.identity/use: "true"
spec:
  serviceAccountName: my-app-sa  # annotated with client ID
```

## Image hygiene

- Always pin images by digest or immutable tag — never use `:latest`.
- Use images from ACR or a trusted registry. Anonymous pulls from Docker Hub are rate-limited.
- Set `imagePullPolicy: Always` when using mutable tags.

## Safeguard rule IDs

| ID | Severity | Description |
|---|---|---|
| no-privileged | high | No privileged containers |
| require-limits | medium | All containers must have resource limits |
| no-hostpath | high | No hostPath volumes |
