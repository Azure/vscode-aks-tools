---
name: kickstart-review
description: "Review phase playbook — validate all generated deployment artifacts."
disable-model-invocation: true
---

# Review Phase

Validate every artifact against security, correctness, and AKS Automatic compliance.

## Checklist

**Dockerfile**: Multi-stage build, pinned base image, non-root user, `.dockerignore` present. Build context + every `COPY`/`ADD` source→destination resolves to real files; `CMD`/`ENTRYPOINT` runs the actual entry point; the image builds and the entry point is present in the built image.

**K8s Manifests**: `runAsNonRoot: true`, no privileged containers, resource requests+limits, liveness/readiness probes, Gateway API HTTPRoute (not Ingress), Workload Identity labels+SA, namespace specified.

**Bicep**: API versions pinned, parameterized env values, secure defaults (TLS 1.2+), outputs defined.

**GitHub Actions**: OIDC auth, minimal `permissions`, environment protection for prod.

## Process

1. **Confirm the image is real, not assumed.** Present a source→destination table for each Dockerfile so the user can verify what lands where:

   | Build context | COPY/ADD source | → destination | Entry point | Port |
   |---|---|---|---|---|
   | `src/order-service` | `package.json`, `src/` | `/app` | `/app/server.js` | 3000 |

   Then confirm (or run) the build validation from `/kickstart-generate` — the image must build and `ls <workdir>` must show the entry point. A missing or mismatched path is a FAIL.
2. Run `/kickstart-safeguard-checklist` for the full safeguard rule set.
3. Run validation via `execute/runInTerminal`:
   ```bash
   kubectl apply --dry-run=client -f k8s/
   az bicep build --file infra/main.bicep
   ```
4. Present results as PASS ✓ / FAIL ✗ / WARN ⚠ per item.
5. If FAILs: use `vscode/askQuestions` — fix automatically (recommended), show details, or skip.
6. If WARNs only: confirm proceeding via `vscode/askQuestions`.

## Exit Criteria
All checks pass. Announce: "Review complete — moving to Pre-Deploy Check."
