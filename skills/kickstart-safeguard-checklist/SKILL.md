---
name: kickstart-safeguard-checklist
description: "AKS deployment safeguard rules checklist for validating Kubernetes manifests."
disable-model-invocation: true
---

# AKS Deployment Safeguard Checklist

This skill provides a comprehensive checklist for validating generated Kubernetes manifests against AKS security and deployment best practices. Use this during the Review phase to ensure all generated configurations comply with organizational policies.

## Safeguard Rules

### Rule: no-privileged
- **Severity**: HIGH
- **Description**: Containers must not run in privileged mode.
- **Check**: Verify that `spec.containers[*].securityContext.privileged` is not set to `true`
- [ ] Pass / Fail

### Rule: require-limits
- **Severity**: MEDIUM
- **Description**: All containers must declare resource limits (CPU and memory).
- **Check**: Verify that `spec.containers[*].resources.limits` is defined for all containers
- [ ] Pass / Fail

### Rule: no-hostpath
- **Severity**: HIGH
- **Description**: Pods must not use hostPath volumes.
- **Check**: Verify that `spec.volumes[*].hostPath` is null or not present
- [ ] Pass / Fail

### Rule: no-latest-tag
- **Severity**: HIGH
- **Description**: Container images must not use the ':latest' tag.
- **Check**: Verify that `spec.containers[*].image` does not end with `:latest`
- [ ] Pass / Fail

### Rule: no-privilege-escalation
- **Severity**: HIGH
- **Description**: Containers must not allow privilege escalation.
- **Check**: Verify that `spec.containers[*].securityContext.allowPrivilegeEscalation` is not set to `true`
- [ ] Pass / Fail

### Rule: no-dangerous-capabilities
- **Severity**: HIGH
- **Description**: Containers must not add dangerous capabilities (SYS_ADMIN, NET_ADMIN, ALL, etc.).
- **Check**: Verify that `spec.containers[*].securityContext.capabilities.add` does not contain any of: `SYS_ADMIN`, `NET_ADMIN`, `ALL`, `SYS_PTRACE`, `SYS_MODULE`, `DAC_READ_SEARCH`
- [ ] Pass / Fail

### Rule: run-as-non-root
- **Severity**: MEDIUM
- **Description**: Containers must run as a non-root user.
- **Check**: Verify that `spec.securityContext.runAsNonRoot` is set to `true`
- [ ] Pass / Fail

### Rule: no-host-network
- **Severity**: HIGH
- **Description**: Pods must not use host networking.
- **Check**: Verify that `spec.hostNetwork` is not set to `true`
- [ ] Pass / Fail

### Rule: no-host-pid
- **Severity**: HIGH
- **Description**: Pods must not share the host PID namespace.
- **Check**: Verify that `spec.hostPID` is not set to `true`
- [ ] Pass / Fail

### Rule: read-only-root-filesystem
- **Severity**: MEDIUM
- **Description**: readOnlyRootFilesystem should be true where the application permits.
- **Check**: Verify `spec.containers[*].securityContext.readOnlyRootFilesystem` is `true` (use tmpfs for writable paths)
- [ ] Pass / Fail

### Rule: gateway-api-for-ingress
- **Severity**: HIGH
- **Description**: Use Gateway API (HTTPRoute) for ingress, not the legacy Ingress resource.
- **Check**: Verify no `kind: Ingress` resources exist; all ingress uses `kind: HTTPRoute` with `gateway.networking.k8s.io/v1` API
- [ ] Pass / Fail

### Rule: workload-identity-required
- **Severity**: HIGH
- **Description**: Azure access must use Workload Identity, not stored credentials.
- **Check**: Verify pods use `azure.workload.identity/use: "true"` label and ServiceAccount with `azure.workload.identity/client-id` annotation. No Azure connection strings or keys in env vars or secrets.
- [ ] Pass / Fail

### Rule: acr-with-acrpull
- **Severity**: HIGH
- **Description**: Container images must be pulled from ACR with AcrPull role binding.
- **Check**: Verify images reference an ACR registry (`*.azurecr.io`). No `imagePullSecrets` with static credentials.
- [ ] Pass / Fail

### Rule: resource-quotas-production
- **Severity**: MEDIUM
- **Description**: Production-tier deployments must define ResourceQuota in the namespace.
- **Check**: Verify a `kind: ResourceQuota` exists in the namespace for production deployments
- [ ] Pass / Fail (N/A for non-production)

### Rule: network-policies-production
- **Severity**: MEDIUM
- **Description**: Production-tier deployments must define NetworkPolicy for pod-to-pod traffic.
- **Check**: Verify a `kind: NetworkPolicy` exists restricting ingress/egress for production deployments
- [ ] Pass / Fail (N/A for non-production)

### Rule: pod-disruption-budget-production
- **Severity**: MEDIUM
- **Description**: Production-tier deployments must define PodDisruptionBudget for high availability.
- **Check**: Verify a `kind: PodDisruptionBudget` exists with appropriate `minAvailable` or `maxUnavailable` for production deployments
- [ ] Pass / Fail (N/A for non-production)

## Automated Validation

When possible, use the `runCommands` tool to validate manifests programmatically:

```bash
# Dry-run validation against K8s API schemas
kubectl apply --dry-run=client -f k8s/

# Validate with kubeconform (if installed)
kubeconform -strict -summary k8s/*.yaml
```

## Review Instructions

When reviewing manifests, use this checklist to validate each safeguard rule:

1. **For each rule above**, examine the relevant manifest sections
2. **Mark the status** for each rule as:
   - ✓ **PASS** — The manifest complies with this rule
   - ✗ **FAIL** — The manifest violates this rule
   - ⊘ **N/A** — This rule does not apply to the manifest (e.g., a Deployment that has no volumes cannot violate the hostPath rule)
3. **Report results** in a summary table showing rule ID, status, and any notes
4. **Block on failures**: Any FAIL on a **HIGH-severity** rule must be fixed before the manifest proceeds to deployment
5. **Address medium-severity failures**: MEDIUM-severity FAILs should be resolved or explicitly justified before proceeding

## Example Review Output

```
| Rule ID | Severity | Status | Notes |
|---------|----------|--------|-------|
| no-privileged | HIGH | ✓ PASS | securityContext.privileged is false |
| require-limits | MEDIUM | ✓ PASS | All containers have CPU/memory limits |
| no-hostpath | HIGH | ✓ PASS | No hostPath volumes defined |
| no-latest-tag | HIGH | ✓ PASS | Image uses pinned tag v1.2.3 |
| ... | ... | ... | ... |
```

## How to Use This Skill

1. **When validating K8s manifests**, reference this checklist to ensure compliance
2. **Review the generated YAML** against each rule listed above
3. **Document any violations** and remediate before proceeding
4. **Use the severity levels** to prioritize fixes (HIGH first, then MEDIUM)

---

*Last updated: Safeguards from `packages/pack-aks-automatic/src/safeguards.json`*
