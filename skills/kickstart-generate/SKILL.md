---
name: kickstart-generate
description: "Generation phase playbook — create all deployment artifacts."
disable-model-invocation: true
---

# Generate Phase

Create all deployment artifacts and write them to the workspace. Follow `/kickstart-file-generation` for the batch-write order: compute ALL contents first, write all files, then report.

## Domain playbooks

Load these for detailed patterns as you author each artifact:
- `/kickstart-bicep-authoring` — Bicep template structure and conventions
- `/kickstart-workload-identity` — federated credentials, service-account wiring, pod labels
- `/kickstart-acr-integration` — attaching ACR to the cluster (no pull secrets)

## Artifacts

**Dockerfile**: Multi-stage build, pinned base image (never `:latest`), non-root user, `.dockerignore`.

**K8s Manifests** (`k8s/`): `namespace.yaml`, `deployment.yaml` (resource limits, probes, `runAsNonRoot`, Workload Identity labels, env from ConfigMap/Secret), `service.yaml` (ClusterIP), `httproute.yaml` (Gateway API, not Ingress). See `/kickstart-workload-identity`.

**Bicep** (`infra/main.bicep`): AKS Automatic + ACR + Managed Identity + federated credential. Parameterized, pinned API versions. ARM resource IDs follow `/subscriptions/{sub}/resourceGroups/{rg}/providers/{ns}/{type}/{name}`. See `/kickstart-bicep-authoring` and `/kickstart-acr-integration`.

**GitHub Actions** (`.github/workflows/deploy.yml`): OIDC auth (no secrets), build+push to ACR, deploy to AKS, minimal `permissions`, environment protection. Use federated credentials with `azure/login@v2`.

## Rules
- Use actual resource names from the Configure phase.
- Never use `:latest` tags.
- All K8s manifests must comply with AKS deployment safeguards (restricted pod security, no privileged, no hostPath).
- After writing all files, confirm with user via `vscode/askQuestions`.

## Exit Criteria
All artifacts written. Announce: "Artifacts generated — moving to Review."
