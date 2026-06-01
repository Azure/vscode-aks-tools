---
name: kickstart-deploy
description: "Deploy phase playbook — provide deployment commands. Never auto-deploy."
disable-model-invocation: true
---

# Deploy Phase

Walk the user through deploying with Azure CLI (`az`) and `kubectl`. **Never run deployment commands automatically** — use `run_in_terminal` to execute each step, but always confirm with the user before proceeding to the next.

## Default Flow: Azure CLI + kubectl

This is the default deployment method. Do not offer GitHub Actions unless the user specifically asks about CI/CD.

## Pre-Deployment: Verify Cluster Ready

Before deploying, confirm the cluster is provisioned and ACR is attached:
```bash
az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "provisioningState" --output tsv
```
If not `Succeeded`, wait and re-check. Then ensure ACR is attached:
```bash
az aks update --name <cluster> --resource-group <rg> --attach-acr <acr> --subscription <sub>
```

## Deployment Steps

Execute each step using `run_in_terminal` with the user's actual resource names filled in. After each step, check the output and confirm success before moving on.

### Step 1: Build and Push Image
```bash
az acr build \
  --registry <acr> \
  --image <image>:<tag> .
```

### Step 2: Get AKS Credentials
```bash
az aks get-credentials --resource-group <rg> --name <cluster> --overwrite-existing
```

### Step 3: Apply Kubernetes Manifests
```bash
kubectl apply -f k8s/
```

### Step 4: Verify Deployment
```bash
kubectl get pods -n <namespace>
kubectl get httproute -n <namespace>
```

Between each step, use `vscode_askQuestions`:
```json
{
  "questions": [{
    "header": "Next step",
    "question": "Step N succeeded. Continue to the next step?",
    "options": [
      { "label": "Continue", "recommended": true },
      { "label": "Show me the output again" },
      { "label": "Stop here" }
    ]
  }]
}
```

## Alternative: GitHub Actions
Only mention this if the user asks about CI/CD or automated pipelines. Push to the main branch (or create a PR) to trigger the GitHub Actions workflow.

## Post-Deployment
- Verify the app is accessible via the gateway URL.
- Check monitoring dashboards — invoke `/kickstart-monitoring`.
- Set up alerts for CPU, memory, and pod restarts.
- Review cost — invoke `/kickstart-cost-estimation`.

## Important
- Default to Azure CLI + kubectl. Do not ask the user to choose a deployment method.
- Execute commands via `run_in_terminal` one at a time.
- Always check output and confirm success before the next step.
- If something fails, help debug but don't auto-retry deployments.
