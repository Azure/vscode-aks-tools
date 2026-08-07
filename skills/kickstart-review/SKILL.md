---
name: kickstart-review
description: "Review phase playbook — validate all generated deployment artifacts."
disable-model-invocation: true
---

# Review Phase

Validate every artifact against security, correctness, and AKS Automatic compliance.

## Checklist

**Dockerfile**: Multi-stage build, pinned base image, non-root user, `.dockerignore` present. Build context + every `COPY`/`ADD` source→destination resolves to real files; `CMD`/`ENTRYPOINT` runs the actual entry point; the image builds and the entry point is present in the built image.

**Dockerfile build**: built with `az acr build` (never `docker build`), with a `RUN test -f <entrypoint>` assertion in the final stage.

**K8s Manifests**: `runAsNonRoot: true`, no privileged containers, resource requests+limits, liveness/readiness probes, `topologySpreadConstraints` or anti-affinity, unique per-Service selectors, CSI `storageClassName` on any PVC, no `kubernetes.azure.com/*` labels, no `CriticalAddonsOnly` toleration, Gateway API HTTPRoute (not Ingress), Workload Identity labels+SA, namespace specified. Run the full `/kickstart-safeguard-checklist` — the mutating safeguards there must already be satisfied in the YAML, not left to the cluster.

**Bicep**: API versions pinned, parameterized env values, secure defaults (TLS 1.2+), outputs defined.

**GitHub Actions**: OIDC auth, minimal `permissions`, environment protection for prod.

## Process

1. **Confirm the image is real, not assumed.** Present a source→destination table for each Dockerfile so the user can verify what lands where:

   | Build context | COPY/ADD source | → destination | Entry point | Port |
   |---|---|---|---|---|
   | `src/order-service` | `package.json`, `src/` | `/app` | `/app/server.js` | 3000 |

   Then confirm (or run) the build validation from `/kickstart-generate`: the image must build via `az acr build`, and the Dockerfile's build-time `RUN test -f <entrypointPath>` assertion must be present and passing. A missing assertion or a failed build is a FAIL. Do not ask for `docker build` / `docker run` output — images are always built server-side in ACR.

2. Run `/kickstart-safeguard-checklist` for the full safeguard rule set.
3. Run validation via `run_in_terminal`:
   ```bash
   kubectl apply --dry-run=client -f k8s/
   az bicep build --file infra/main.bicep
   ```
   `--dry-run=server` is preferable when the cluster is reachable: it runs the admission webhooks, so it surfaces real Deployment Safeguard violations and shows the mutated result.
4. Present results as PASS ✓ / FAIL ✗ / WARN ⚠ per item.
5. If FAILs: use `vscode_askQuestions` — fix automatically (recommended), show details, or skip.
6. If WARNs only: confirm proceeding via `vscode_askQuestions`.

## Exit Criteria
All checks pass. Announce: "Review complete — moving to Pre-Deploy Check."
