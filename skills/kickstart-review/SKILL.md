---
name: kickstart-review
description: "Review phase playbook — validate all generated deployment artifacts."
disable-model-invocation: true
---

# Review Phase

Validate every generated artifact against security, correctness, and AKS Automatic compliance standards.

## Review Checklist

### Dockerfile
- [ ] Multi-stage build
- [ ] Base image pinned to specific version
- [ ] Non-root user
- [ ] `.dockerignore` present

### Kubernetes Manifests
- [ ] `runAsNonRoot: true`
- [ ] No privileged containers (`allowPrivilegeEscalation: false`)
- [ ] Resource requests AND limits set
- [ ] Liveness and readiness probes defined
- [ ] Gateway API HTTPRoute used (not Ingress)
- [ ] Workload Identity configured (labels + service account)
- [ ] Namespace specified

### Bicep Templates
- [ ] API versions pinned
- [ ] Parameters for environment-specific values
- [ ] Secure defaults (TLS 1.2+, private endpoints)
- [ ] Outputs for downstream use

### GitHub Actions
- [ ] OIDC auth (no long-lived secrets)
- [ ] `permissions` block minimal
- [ ] Environment protection for prod

## Process
1. Invoke `/kickstart-safeguard-checklist` to run the full safeguard rule set (13 rules including DS008-DS013 for production).
2. Invoke `/kickstart-security-hardening` for security checks.
3. Run automated validation using `run_in_terminal`:
   ```bash
   kubectl apply --dry-run=client -f k8s/
   az bicep build --file infra/main.bicep
   hadolint Dockerfile
   ```
   Use `get_terminal_output` to read results.
4. Present results as PASS ✓ / FAIL ✗ / WARN ⚠ for each item.
5. If any FAIL items, use `vscode_askQuestions` to decide next steps:
   ```json
   {
     "questions": [{
       "header": "Review failures",
       "question": "Some checks failed. How do you want to proceed?",
       "options": [
         { "label": "Fix all failures automatically", "recommended": true },
         { "label": "Show me the details first" },
         { "label": "Skip and proceed anyway" }
       ]
     }]
   }
   ```
6. If WARN only, use `vscode_askQuestions` to confirm proceeding:
   ```json
   {
     "questions": [{
       "header": "Warnings found",
       "question": "All checks pass but there are warnings. Continue to Handoff?",
       "options": [
         { "label": "Continue — warnings are acceptable", "recommended": true },
         { "label": "Show me the warnings first" }
       ]
     }]
   }
   ```

## Exit Criteria
- All checks pass (no FAIL items remaining).
- Announce: "Review complete — moving to the Handoff phase."
