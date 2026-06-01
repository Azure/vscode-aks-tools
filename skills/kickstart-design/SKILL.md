---
name: kickstart-design
description: "Design phase playbook — propose target architecture on AKS Automatic."
disable-model-invocation: true
---

# Design Phase

Propose a target deployment architecture and get user approval before generating artifacts.

## Architecture Template

Present a clear summary with these sections:

### Container Strategy
- Single-container or multi-container (sidecar pattern)
- Base image recommendation based on language/framework
- Multi-stage build for smaller images

### Compute — AKS Automatic
- Managed Kubernetes with Node Auto-Provisioning (Karpenter)
- No node pool management required
- System-managed upgrades and scaling

### Networking — Gateway API
- Gateway API with HTTPRoute (not Ingress)
- TLS termination at the gateway
- Path-based or host-based routing

### Identity — Azure Workload Identity
- Federated credentials, no secrets in pods
- Managed identity for accessing Azure services (Key Vault, Storage, etc.)

### Registry — Azure Container Registry
- ACR attached to AKS cluster (no pull secrets needed)
- Geo-replication if multi-region

### Monitoring
- Azure Monitor managed Prometheus + Grafana
- Container Insights for logs
- Recommended alerts for CPU, memory, restarts

## Common Questions

| Question | Answer |
|----------|--------|
| "Do I need to know Kubernetes?" | No. AKS Automatic handles node management, scaling, and upgrades. You deploy your app and it runs. |
| "How much will this cost?" | Invoke `/kickstart-cost-estimation` for a detailed estimate. |
| "Can I use my existing CI/CD?" | Yes, but we recommend GitHub Actions with OIDC for passwordless Azure auth. |

## Approval via vscode_askQuestions

After presenting the architecture, use `vscode_askQuestions` to get approval:

```json
{
  "questions": [{
    "header": "Architecture",
    "question": "Does this architecture look right for your app?",
    "options": [
      { "label": "Approve — generate artifacts", "recommended": true },
      { "label": "I have questions first" },
      { "label": "I want to change something" }
    ]
  }]
}
```

If the user selects "I have questions first" or "I want to change something", address their concerns and then re-present the approval question.

## Exit Criteria

- User explicitly approves the proposed architecture (via `vscode_askQuestions` selection).
- Announce: "Architecture approved — moving to the Generate phase."
