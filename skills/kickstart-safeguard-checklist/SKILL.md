---
name: kickstart-safeguard-checklist
description: "AKS deployment safeguard rules checklist for validating Kubernetes manifests."
disable-model-invocation: true
---

# AKS Deployment Safeguard Checklist

This skill provides a comprehensive checklist for validating generated Kubernetes manifests. Use this during the Review phase.

It has **two parts**, and they are not interchangeable:

- **Part A — AKS Deployment Safeguards.** The policies AKS Automatic actually enforces at admission. Some **mutate** your object instead of rejecting it, so a manifest that omits them will be silently rewritten by the cluster. Generate these correctly up front (see `/kickstart-generate`) so the mutators are no-ops.
- **Part B — Pod security & deployment best practice.** Additional hardening checks Kickstart applies. Valuable, but *not* the AKS Deployment Safeguards policy set — don't conflate the two when reporting.

---

# Part A — AKS Deployment Safeguards (policy-enforced)

| # | Safeguard policy | Severity | Mutation outcome if available |
|---|---|---|---|
| A1 | Cannot Edit Individual Nodes | HIGH | N/A — rejected, not mutated |
| A2 | Containers CPU and memory resource **requests** must be defined | HIGH | **Mutates** — sets default CPU/memory requests and enforces minimums |
| A3 | Must have anti-affinity rules or `topologySpreadConstraints` set | MEDIUM | **Mutates** — adds pod anti-affinity + topology spread constraints (multi-replica workloads) |
| A4 | No AKS-specific labels | MEDIUM | N/A |
| A5 | Containers should only use allowed images | HIGH | N/A |
| A6 | Reserved system pool taints | MEDIUM | **Mutates** — removes the `CriticalAddonsOnly` taint from user node pools |
| A7 | Containers have readiness or liveness probes configured | HIGH | N/A |
| A8 | Clusters should use CSI driver StorageClass | MEDIUM | N/A |
| A9 | Services should use unique selectors | HIGH | N/A |
| A10 | Container images should not include `latest` tag | HIGH | N/A |

### A1: cannot-edit-individual-nodes
- **Check**: No manifest, script, or command targets an individual Node — no `kind: Node` objects, no `kubectl label/taint/cordon node`, no `nodeSelector`/`nodeName` pinning to a specific node name. Use node pools and pool-level labels instead.
- [ ] Pass / Fail

### A2: require-requests  *(mutating)*
- **Check**: Every container (including init containers and sidecars) declares `resources.requests.cpu` **and** `resources.requests.memory`. Limits alone are not sufficient.
- **If omitted**: the injected defaults are large — **CPU `500m` and memory `2048Mi` (2Gi) per container**, set as both request and limit. On a multi-container pod that is a real scheduling and cost surprise, so always declare requests explicitly.
- **Enforced minimums**: CPU `100m`, memory `100Mi`. Values below these are raised. If a request ends up above its limit the request is capped to the limit to keep the QoS class valid.
- [ ] Pass / Fail

### A3: require-spread-or-anti-affinity  *(mutating)*
- **Applies to**: multi-replica workloads. The policy error reads `Deployment with 2 replicas should have either podAntiAffinity or topologySpreadConstraints set` — single-replica workloads aren't flagged. Generate the constraints anyway, so scaling up later doesn't silently trigger a mutation.
- **Check**: Each Deployment/StatefulSet sets `spec.template.spec.topologySpreadConstraints` **or** `affinity.podAntiAffinity`. Prefer topology spread on `kubernetes.io/hostname` with `whenUnsatisfiable: ScheduleAnyway`.
- **If omitted**: AKS adds a preferred pod anti-affinity rule (weight 100, topology key `kubernetes.io/hostname`) plus a topology spread constraint (`maxSkew: 1`, `whenUnsatisfiable: ScheduleAnyway`). It picks the selector label by priority — `app`, then `app.kubernetes.io/name`, else a generated `default-antiaffinity-applabel=<workload-name>`. The mutator skips a workload entirely if *either* pod anti-affinity or any topology spread constraint already exists.
- [ ] Pass / Fail

### A4: no-aks-specific-labels
- **Check**: No object sets a `kubernetes.azure.com/*` **label**. These are reserved for AKS (`Label kubernetes.azure.com is reserved for AKS use only`).
- **Scope**: labels only. The policy does not inspect `metadata.annotations` — the safeguards docs name the annotation field explicitly where they mean it (e.g. the AppArmor rule). Even so, don't put `kubernetes.azure.com/*` in an annotation; the prefix is reserved by convention regardless of which field is enforced.
- `azure.workload.identity/*` labels and annotations are **not** covered by this rule and are required for Workload Identity.
- [ ] Pass / Fail

### A5: allowed-images-only
- **Check**: Every image resolves to a registry the cluster permits — normally the Phase 2 ACR (`<acr>.azurecr.io/...`). Flag any third-party image (`docker.io/...`, `ghcr.io/...`) that must first be brought in with `az acr import`.
- [ ] Pass / Fail

### A6: reserved-system-pool-taints  *(mutating)*
- **Applies to**: Node and node-pool configuration, not Pod tolerations. The policy evaluates node `spec.taints` and excludes system pools by their `kubernetes.azure.com/mode` label.
- **Check**: No generated user node pool config sets the `CriticalAddonsOnly` taint. AKS reserves it for system pools.
- **If present**: AKS removes the taint from the user pool.
- [ ] Pass / Fail (N/A when no user node pool configuration is generated)

### A7: require-probes
- **Check**: Every container defines a `readinessProbe` **or** `livenessProbe` (Kickstart generates both). The path and port must match the app's real health endpoint from the structure map — not a guessed `/healthz`.
- [ ] Pass / Fail

### A8: csi-storageclass
- **Check**: the policy evaluates the StorageClass **provisioner**, not its name. In-tree `kubernetes.io/azure-disk` and `kubernetes.io/azure-file` are rejected (`Storage class <name> use intree provisioner ... is not allowed`); use `disk.csi.azure.com` or `file.csi.azure.com`.
- In practice: set `storageClassName` on every PVC to a CSI-backed class (`managed-csi`, `managed-csi-premium`, `azurefile-csi`) rather than relying on an unset default, and verify the class's provisioner if it's cluster-custom.
- [ ] Pass / Fail (N/A when no PVCs)

### A9: unique-service-selectors
- **Check**: No two Services share a selector, and each Service's selector matches exactly one workload. In monorepos do not reuse `app: <appName>` across services — use `app: <serviceName>` or `app.kubernetes.io/name` + `app.kubernetes.io/component`.
- [ ] Pass / Fail

### A10: no-latest-tag
- **Check**: No image reference ends in `:latest` or omits a tag (an untagged image resolves to `latest`). Applies to init containers and sidecars too.
- [ ] Pass / Fail

---

### Enforcement caveats

- **Gatekeeper runs fail-open.** If the admission webhook doesn't respond, validation is skipped and a non-compliant workload is admitted. Safeguards are a backstop, not a guarantee — generate compliant manifests rather than relying on enforcement to catch mistakes.
- **All or nothing.** Safeguards can't be enabled selectively; turning on `Warn` or `Enforce` activates every policy. Namespaces can be excluded, but on AKS Automatic the level can't be lowered from `Enforce`.

---

# Part B — Pod security & best practice

### Rule: no-system-pool-toleration
- **Severity**: MEDIUM
- **Description**: Ordinary app pods should not tolerate the system pool's `CriticalAddonsOnly` taint. A toleration permits scheduling onto a matching tainted node but does not attract the pod there; this is a Kickstart best practice, not the A6 policy check.
- **Check**: Verify app workloads do not declare a `CriticalAddonsOnly` toleration.
- [ ] Pass / Fail

### Rule: no-privileged
- **Severity**: HIGH
- **Description**: Containers must not run in privileged mode.
- **Check**: Verify that `spec.containers[*].securityContext.privileged` is not set to `true`
- [ ] Pass / Fail

### Rule: require-limits
- **Severity**: MEDIUM
- **Description**: All containers must declare resource limits (CPU and memory). Requests are covered separately by the policy-enforced **A2**.
- **Check**: Verify that `spec.containers[*].resources.limits` is defined for all containers
- [ ] Pass / Fail

### Rule: no-hostpath
- **Severity**: HIGH
- **Description**: Pods must not use hostPath volumes.
- **Check**: Verify that `spec.volumes[*].hostPath` is null or not present
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
# Schema-only validation (works with no cluster)
kubectl apply --dry-run=client -f k8s/

# BEST: server dry-run runs the real admission webhooks — this is what actually
# evaluates Part A, and it shows you the mutated result before you commit to it.
kubectl apply --dry-run=server -f k8s/

# Diff your YAML against what the cluster would store (reveals safeguard mutations)
kubectl diff -f k8s/

# Validate with kubeconform (if installed)
kubeconform -strict -summary k8s/*.yaml
```

`--dry-run=server` requires cluster credentials (Phase 6). Before that, evaluate Part A by reading the manifests.

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
6. **Never leave a mutating safeguard (A2, A3, A6) to the cluster.** A FAIL there won't block admission — AKS will quietly rewrite the object, so the deployed state stops matching the generated YAML and later `kubectl diff` output becomes confusing. Fix these in the manifest even though they "would work anyway."
7. **Report Part A and Part B separately** so the user can see policy compliance distinctly from hardening advice.

## Example Review Output

**Part A — AKS Deployment Safeguards**

```
| ID | Safeguard | Severity | Mutating | Status | Notes |
|----|-----------|----------|----------|--------|-------|
| A2 | require-requests | HIGH | yes | ✓ PASS | cpu 100m / memory 128Mi on all containers |
| A3 | spread-or-anti-affinity | MEDIUM | yes | ✓ PASS | topologySpreadConstraints on hostname |
| A9 | unique-service-selectors | HIGH | no | ✗ FAIL | api and worker Services both select app: store |
| A10 | no-latest-tag | HIGH | no | ✓ PASS | pinned tag v1.2.3 |
| ... | ... | ... | ... | ... | ... |
```

**Part B — Pod security & best practice**

```
| Rule ID | Severity | Status | Notes |
|---------|----------|--------|-------|
| no-privileged | HIGH | ✓ PASS | securityContext.privileged is false |
| require-limits | MEDIUM | ✓ PASS | All containers have CPU/memory limits |
| no-hostpath | HIGH | ✓ PASS | No hostPath volumes defined |
| ... | ... | ... | ... |
```

## How to Use This Skill

1. **When validating K8s manifests**, reference this checklist to ensure compliance
2. **Review the generated YAML** against each rule listed above
3. **Document any violations** and remediate before proceeding
4. **Use the severity levels** to prioritize fixes (HIGH first, then MEDIUM)

---

*Part A: AKS Automatic Deployment Safeguards policy set (mutation outcomes per AKS docs). Part B: `packages/pack-aks-automatic/src/safeguards.json`.*
