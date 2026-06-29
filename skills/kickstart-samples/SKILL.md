---
name: kickstart-samples
description: "Sample repository profiles for quick-start onboarding."
disable-model-invocation: true
---

# Sample Repos

**If the launch wizard already selected a sample**, skip the picker and clone that sample directly (see the table below). Otherwise, present this exact picker via `vscode/askQuestions`:
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

After the user picks, clone with `execute/runInTerminal`:

| Sample | Clone command |
|---|---|
| AKS Store Demo | `git clone https://github.com/Azure-Samples/aks-store-demo.git` |
| Azure Voting App | `git clone https://github.com/Azure-Samples/azure-voting-app-redis.git` |
| Contoso Real Estate | `git clone https://github.com/Azure-Samples/contoso-real-estate.git` |

After cloning, **do a quick structure scan to confirm the profile** — the paths below are the expected layout, but samples change. Use `search`/`search/codebase` to verify each service's build context, `Dockerfile` path, and entry-point file actually exist before relying on them. Then present the (corrected) profile and confirm it via `vscode/askQuestions` ("Looks good, continue to Configure" recommended). **Skip the Discovery questions** — but never skip this structure check — then go straight to Phase 2.

**AKS Store Demo** (monorepo, services under `src/`): `store-front` (Node.js, :8080, context `src/store-front`), `order-service` (Node.js, :3000, context `src/order-service`), `product-service` (Go, :3002, context `src/product-service`), `makeline-service` (Rust, :3001, context `src/makeline-service`). Each service dir is its own build context and ships a `Dockerfile`. Deps: MongoDB, RabbitMQ. Has K8s manifests, GitHub Actions.

**Azure Voting App** (`Azure-Samples/azure-voting-app-redis`): `azure-vote` (Python/Flask, :80). Build context `azure-vote/`, Dockerfile `azure-vote/Dockerfile`, entry point `azure-vote/azure-vote/main.py` — note the nested dir, a classic flat-structure trap. Deps: Redis. Has K8s manifests. No GitHub Actions.

**Contoso Real Estate** (monorepo, packages under `packages/`): `portal` (Next.js, :3000, context `packages/portal`), `api` (Fastify, :3001, context `packages/api`). Deps: PostgreSQL. Partial Dockerfiles (generate the missing ones), no K8s manifests, has GitHub Actions.
