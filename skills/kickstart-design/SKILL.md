---
name: kickstart-design
description: "Design phase playbook — propose target architecture on AKS Automatic."
disable-model-invocation: true
---

# Design Phase

Propose a target deployment architecture and get user approval.

## Architecture Template

Present a summary covering:

**Container strategy**: Single or multi-container. Multi-stage builds. Pin base images to specific versions.

**AKS Automatic**: Managed Kubernetes with Node Auto-Provisioning (Karpenter). Auto-upgrades (default: `patch` channel). No node pools to manage. Define `PodDisruptionBudget` for stateful workloads.

**Networking**: Gateway API with HTTPRoute (not Ingress). `GatewayClass: azure-application-lb` is pre-installed. Cilium network policies enabled by default. Clusters are private by default (API server via private endpoint).

**Identity**: Azure Workload Identity — federated credentials, no secrets in pods. Managed identity for Azure services (Key Vault, Storage). Prefer managed identity over service principals.

**Registry**: ACR attached to AKS (no pull secrets). Geo-replication if multi-region.

**Monitoring**: Azure Monitor managed Prometheus + Grafana (auto-enabled). Container Insights for logs. Alert on CPU >80%, pod restarts >5, PVC >85%.

## Common Questions

| Question | Answer |
|---|---|
| "Do I need Kubernetes knowledge?" | No. AKS Automatic manages nodes, scaling, upgrades. |
| "How much will this cost?" | Invoke `/kickstart-cost-estimation`. |
| "Can I use existing CI/CD?" | Yes, but recommend GitHub Actions with OIDC. |

## Exit Criteria
User approves the architecture via `vscode_askQuestions`. Announce: "Architecture approved — moving to Generate."
