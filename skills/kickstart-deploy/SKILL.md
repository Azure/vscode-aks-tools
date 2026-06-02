---
name: kickstart-deploy
description: "Deploy phase playbook — build, push, apply with Azure CLI and kubectl."
disable-model-invocation: true
---

# Deploy Phase

Deploy using Azure CLI and `kubectl`. Execute each step via `run_in_terminal`, confirm between steps with `vscode_askQuestions`. Never auto-deploy.

## Steps

1. **Build and push**: `az acr build --registry <acr> --image <image>:<tag> .`
   Tag with a version (e.g. v1.0.0), never `:latest`. Use the project path as build context.

2. **Get credentials**: `az aks get-credentials --resource-group <rg> --name <cluster> --overwrite-existing`
   kubelogin handles AAD auth automatically (verified in Pre-Deploy Check). Never use `--admin`.

3. **Apply manifests**: `kubectl apply -f k8s/`

4. **Verify**: `kubectl get pods -n <namespace>` and `kubectl get services -n <namespace>`
   If pods not Ready, run `kubectl describe pod <name>` and `kubectl logs <name>` to diagnose.

## Error Handling

Classify failures:
- **auth** — Azure/registry authentication, RBAC, OIDC, kubeconfig
- **config** — missing or invalid configuration (subscription, RG, cluster, ACR, manifest)
- **dependency** — missing CLI tool, extension, or container image
- **cluster** — pod CrashLoopBackOff, ImagePullBackOff, scheduling, quota

Provide specific `az` or `kubectl` fix commands. Offer retry via `vscode_askQuestions`.

## Post-Deployment

- Verify app accessible via `kubectl get services` (external IP or gateway URL).
- Check Azure Monitor dashboards (managed Prometheus + Grafana auto-enabled).
- Set up alerts: CPU >80%, memory >85%, pod restarts >5.

Only mention GitHub Actions if the user asks about CI/CD.
