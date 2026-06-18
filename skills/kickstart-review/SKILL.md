---
name: kickstart-review
description: "Review phase playbook — validate all generated deployment artifacts."
disable-model-invocation: true
---

# Review Phase

Validate every artifact against security, correctness, and AKS Automatic compliance.

## Checklist

**Dockerfile**: Multi-stage build, pinned base image, non-root user, `.dockerignore` present.

**K8s Manifests**: `runAsNonRoot: true`, no privileged containers, resource requests+limits, liveness/readiness probes, Gateway API HTTPRoute (not Ingress), Workload Identity labels+SA, namespace specified.

**Bicep**: API versions pinned, parameterized env values, secure defaults (TLS 1.2+), outputs defined.

**GitHub Actions**: OIDC auth, minimal `permissions`, environment protection for prod.

## Process

1. Run `/kickstart-safeguard-checklist` for the full safeguard rule set.
2. Run validation via `execute/runInTerminal`:
   ```bash
   kubectl apply --dry-run=client -f k8s/
   az bicep build --file infra/main.bicep
   ```
3. Present results as PASS ✓ / FAIL ✗ / WARN ⚠ per item.
4. If FAILs: use `vscode/askQuestions` — fix automatically (recommended), show details, or skip.
5. If WARNs only: confirm proceeding via `vscode/askQuestions`.

## Exit Criteria
All checks pass. Announce: "Review complete — moving to Pre-Deploy Check."
