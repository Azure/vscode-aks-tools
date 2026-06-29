---
name: kickstart-deploy
description: "Deploy phase playbook — build, push, apply with Azure CLI and kubectl."
disable-model-invocation: true
---

# Deploy Phase

Deploy using Azure CLI and `kubectl`. Execute each step via `execute/runInTerminal`, confirm between steps with `vscode/askQuestions`. Never auto-deploy.

## Steps

1. **Build and push**: `az acr build --registry <acr> --image <image>:<tag> -f <dockerfilePath> <buildContext>`
   Use the build context and Dockerfile path from the structure map — never assume repo root (`.`). For monorepos, build each service from its own context. Tag with a version (e.g. v1.0.0), never `:latest`.

2. **Get credentials**: `az aks get-credentials --resource-group <rg> --name <cluster> --overwrite-existing`
   kubelogin handles AAD auth automatically (verified in Pre-Deploy Check). Never use `--admin`.

3. **Apply manifests**: `kubectl apply -f k8s/`

4. **Verify**: `kubectl get pods -n <namespace>` and `kubectl get services -n <namespace>`
   If pods not Ready, run `kubectl describe pod <name>` and `kubectl logs <name>` to diagnose.

5. **Health-check the running app**: don't declare success on pod readiness alone — actually hit the app and compare against the expected response:
   - Via the gateway/service URL from `kubectl get httproute` / `kubectl get services`: `curl -sS -o /dev/null -w "%{http_code}" http://<url>/` (expect 2xx/3xx).
   - Or in-cluster: `kubectl exec <pod> -n <namespace> -- curl -sS localhost:<port>/<health-path>`.
   If the response isn't what the app should return (wrong status, error body, or logs show a missing entry point), classify as a `cluster` failure and diagnose before reporting success.

## Error Handling

Classify failures:
- **auth** — Azure/registry authentication, RBAC, OIDC, kubeconfig
- **config** — missing or invalid configuration (subscription, RG, cluster, ACR, manifest)
- **dependency** — missing CLI tool, extension, or container image
- **cluster** — pod CrashLoopBackOff, ImagePullBackOff, scheduling, quota

Provide specific `az` or `kubectl` fix commands. Offer retry via `vscode/askQuestions`.

## Post-Deployment

- Confirm the app actually responds at its external IP / gateway URL (the health-check above) — not just that the service has an address.
- Check Azure Monitor dashboards (managed Prometheus + Grafana auto-enabled).
- Set up alerts: CPU >80%, memory >85%, pod restarts >5.

Only mention GitHub Actions if the user asks about CI/CD.
