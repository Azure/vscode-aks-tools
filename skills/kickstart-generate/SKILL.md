---
name: kickstart-generate
description: "Generation phase playbook — create all deployment artifacts."
disable-model-invocation: true
---

# Generate Phase

Create all deployment artifacts and write them to the workspace. Compute ALL contents first, write all files, then report.

## Artifacts

**Dockerfile**: Multi-stage build, pinned base image (never `:latest`), non-root user, `.dockerignore`.

**K8s Manifests** (`k8s/`): `namespace.yaml`, `deployment.yaml` (resource limits, probes, `runAsNonRoot`, Workload Identity labels, env from ConfigMap/Secret), `service.yaml` (ClusterIP), `httproute.yaml` (Gateway API, not Ingress).

**Bicep** (`infra/main.bicep`): AKS Automatic + ACR + Managed Identity + federated credential. Parameterized, pinned API versions. ARM resource IDs follow `/subscriptions/{sub}/resourceGroups/{rg}/providers/{ns}/{type}/{name}`.

**GitHub Actions** (`.github/workflows/deploy.yml`): OIDC auth (no secrets), build+push to ACR, deploy to AKS, minimal `permissions`, environment protection. Use federated credentials with `azure/login@v2`.

## Rules
- Use actual resource names from the Configure phase.
- Never use `:latest` tags.
- All K8s manifests must comply with AKS deployment safeguards (restricted pod security, no privileged, no hostPath).
- After writing all files, confirm with user via `vscode_askQuestions`.

## Exit Criteria
All artifacts written. Announce: "Artifacts generated — moving to Review."
