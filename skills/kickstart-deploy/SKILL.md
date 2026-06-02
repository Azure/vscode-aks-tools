---
name: kickstart-deploy
description: "Deploy phase playbook — build, push, apply with Azure CLI and kubectl."
disable-model-invocation: true
---

# Deploy Phase

Deploy using Azure CLI and `kubectl`. Execute each step via `run_in_terminal`, confirm between steps with `vscode_askQuestions`. Never auto-deploy.

## Steps

1. **Build and push**: `az acr build --registry <acr> --image <image>:<tag> .`
2. **Get credentials**: `az aks get-credentials --resource-group <rg> --name <cluster> --overwrite-existing`
3. **Apply manifests**: `kubectl apply -f k8s/`
4. **Verify**: `kubectl get pods -n <namespace>` and `kubectl get httproute -n <namespace>`

Confirm success between each step. If a step fails, help debug — don't auto-retry.

## Post-Deployment

- Verify app accessible via gateway URL.
- Check Azure Monitor dashboards (managed Prometheus + Grafana auto-enabled, Container Insights for logs).
- Set up alerts: CPU >80%, memory >85%, pod restarts >5.
- Estimated costs: AKS Automatic ~$70+/mo base, ACR Basic ~$5/mo. Use Azure Pricing Calculator for precise estimates.

Only mention GitHub Actions if the user asks about CI/CD.
