---
name: kickstart-github-actions-workflow
description: Conventions for authoring GitHub Actions CI/CD workflows for AKS deployments.
disable-model-invocation: true
---

# GitHub Actions Workflow Structure

## Standard deployment workflow layout

```yaml
name: Deploy to AKS

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  id-token: write   # Required for OIDC
  contents: read

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - name: Build and push image to ACR
        run: |
          az acr build \
            --registry ${{ vars.ACR_NAME }} \
            --image ${{ vars.IMAGE_NAME }}:${{ github.sha }} .

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/aks-set-context@v4
        with:
          cluster-name: ${{ vars.AKS_CLUSTER_NAME }}
          resource-group: ${{ vars.AKS_RESOURCE_GROUP }}
      - run: kubectl apply -f k8s/
```

## Key conventions

### Permissions block
Always declare the minimum required permissions at the workflow or job level:
- `id-token: write` — required for OIDC
- `contents: read` — safe default; upgrade to `write` only for release commits

### Triggers
- Use `push` on the default branch for deployments.
- Use `pull_request` for validation (build + test, no deploy).
- Add `workflow_dispatch` for manual runs.

### Environments
Use GitHub Environments for production deployments to enforce:
- Required reviewers
- Deployment protection rules
- Environment-scoped secrets

### Job dependencies
Use `needs:` to sequence jobs. Keep build and deploy in separate jobs so a failed build prevents deployment.

### Caching
Cache dependencies with `actions/cache` to speed up builds. Key on lockfile hash.

## ACR integration

```yaml
- name: Log in to ACR
  run: az acr login --name ${{ vars.ACR_NAME }}
```

Tag images with `github.sha` for traceability. Never use `latest` as a deployment tag.
