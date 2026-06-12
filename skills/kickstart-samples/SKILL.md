---
name: kickstart-samples
description: "Sample repository profiles for quick-start onboarding."
disable-model-invocation: true
---

# Sample Repos

**If the launch wizard already selected a sample**, skip the picker and clone that sample directly (see the table below). Otherwise, present this exact picker via `vscode_askQuestions`:
```json
{
  "questions": [{
    "header": "Sample project",
    "question": "Which sample would you like to start with?",
    "options": [
      { "label": "AKS Store Demo", "description": "Microservices app — 4 services (Node.js, Go, Rust) + MongoDB + RabbitMQ", "recommended": true },
      { "label": "Azure Voting App", "description": "Simple two-container app — Python/Flask + Redis" },
      { "label": "Contoso Real Estate", "description": "Full-stack JavaScript — Next.js + Fastify + PostgreSQL" }
    ]
  }]
}
```

After the user picks, clone with `run_in_terminal`:

| Sample | Clone command |
|---|---|
| AKS Store Demo | `git clone https://github.com/Azure-Samples/aks-store-demo.git` |
| Azure Voting App | `git clone https://github.com/Azure-Samples/azure-voting-app-redis.git` |
| Contoso Real Estate | `git clone https://github.com/Azure-Samples/contoso-real-estate.git` |

Then present the pre-filled profile below and confirm it with the user via `vscode_askQuestions` ("Looks good, continue to Configure" recommended). **Skip Discovery entirely** — go straight to Phase 2.

**AKS Store Demo**: Monorepo, 4 services — `store-front` (Node.js:8080), `order-service` (Node.js:3000), `product-service` (Go:3002), `makeline-service` (Rust:3001). Deps: MongoDB, RabbitMQ. Has Dockerfiles, K8s manifests, GitHub Actions.

**Azure Voting App**: Single app — `azure-vote` (Python/Flask:80). Deps: Redis. Has Dockerfile and K8s manifests. No GitHub Actions.

**Contoso Real Estate**: Monorepo — `portal` (Next.js:3000), `api` (Fastify:3001). Deps: PostgreSQL. Partial Dockerfiles, no K8s manifests, has GitHub Actions.
