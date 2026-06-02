---
name: kickstart-samples
description: "Sample repository profiles for quick-start onboarding."
disable-model-invocation: true
---

# Sample Repos

Use `vscode_askQuestions` to let the user pick, then clone with `run_in_terminal`.

| Sample | Repo URL | Clone command |
|---|---|---|
| AKS Store Demo | `Azure-Samples/aks-store-demo` | `git clone https://github.com/Azure-Samples/aks-store-demo.git` |
| Azure Voting App | `Azure-Samples/azure-voting-app-redis` | `git clone https://github.com/Azure-Samples/azure-voting-app-redis.git` |
| Contoso Real Estate | `Azure-Samples/contoso-real-estate` | `git clone https://github.com/Azure-Samples/contoso-real-estate.git` |

## Pre-filled Profiles

For sample repos, skip Discovery — confirm the profile with the user and jump to Configure.

**AKS Store Demo**: Monorepo, 4 services — `store-front` (Node.js:8080), `order-service` (Node.js:3000), `product-service` (Go:3002), `makeline-service` (Rust:3001). Deps: MongoDB, RabbitMQ. Has Dockerfiles, K8s manifests, GitHub Actions.

**Azure Voting App**: Single app — `azure-vote` (Python/Flask:80). Deps: Redis. Has Dockerfile and K8s manifests. No GitHub Actions.

**Contoso Real Estate**: Monorepo — `portal` (Next.js:3000), `api` (Fastify:3001). Deps: PostgreSQL. Partial Dockerfiles, no K8s manifests, has GitHub Actions.
