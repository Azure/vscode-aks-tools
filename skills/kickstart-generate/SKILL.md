---
name: kickstart-generate
description: "Generation phase playbook — create all deployment artifacts."
disable-model-invocation: true
---

# Generate Phase

Create all deployment artifacts and write them to the workspace.

## Artifact Checklist

### 1. Dockerfile
- Multi-stage build (build stage + runtime stage)
- Pin base image to specific version (e.g., `node:22.15-alpine3.21`, not `node:latest`)
- Run as non-root user
- Copy only necessary files
- Create `.dockerignore` if it doesn't exist

### 2. Kubernetes Manifests (`k8s/`)
- `namespace.yaml` — dedicated namespace
- `deployment.yaml` — pod spec with:
  - Resource requests and limits
  - Liveness and readiness probes
  - `runAsNonRoot: true`, `allowPrivilegeEscalation: false`
  - Workload Identity labels and service account annotations
  - Environment variables from ConfigMap/Secret refs
- `service.yaml` — ClusterIP service
- `httproute.yaml` — Gateway API HTTPRoute (not Ingress)

### 3. Bicep Templates (`infra/`)
- `main.bicep` — orchestrates all resources:
  - AKS Automatic cluster
  - Azure Container Registry
  - Managed Identity + federated credential
  - Gateway API configuration
- Use parameters for environment-specific values (resource group, region, names)
- Pin API versions

### 4. GitHub Actions (`.github/workflows/deploy.yml`)
- OIDC authentication with Azure (no long-lived secrets)
- Build and push to ACR
- Deploy to AKS
- Environment protection for production
- Minimal `permissions` block

## Rules
- Invoke domain skills for detailed authoring guidance before writing files.
- Compute ALL file contents before writing any. Then write all files. Then report what was created.
- Never use `:latest` tags.
- All K8s manifests must comply with AKS deployment safeguards.
- Use `run_in_terminal` for any validation commands (e.g., linting generated files).
- After writing all files, use `vscode_askQuestions` to confirm:
  ```json
  {
    "questions": [{
      "header": "Files generated",
      "question": "All artifacts have been written. Ready to review them?",
      "options": [
        { "label": "Yes, start the review", "recommended": true },
        { "label": "Show me what was created first" },
        { "label": "I want to make changes" }
      ]
    }]
  }
  ```

## Exit Criteria
- All artifacts written to workspace.
- Announce: "All artifacts generated — moving to the Review phase."
