---
name: kickstart-generate
description: "Generation phase playbook — create all deployment artifacts."
disable-model-invocation: true
---

# Generate Phase

Create all deployment artifacts and write them to the workspace. Follow `/kickstart-file-generation` for the batch-write order: compute ALL contents first, write all files, then report.

## Build from the structure map, not assumptions

Use the per-service structure map from Discovery (build context, entry point, existing Dockerfile path). Never assume the app sits at the repo root.

- **Reuse existing Dockerfiles.** If a service already ships a working `Dockerfile`, use it as-is (or amend in place) — do not generate a parallel one. Only author a Dockerfile for services that lack one.
- **Cross-check every `COPY`/`ADD`.** Each source must resolve to a real file/dir inside that service's build context, and the destination must match where the entry point runs (e.g. `WORKDIR /app` + `COPY . /app` only if the entry point is at the context root). Use `search`/`codebase` to confirm sources exist before writing the Dockerfile; flag and fix any mismatch.
- **Set the run target from the real entry point** (`CMD`/`ENTRYPOINT`), not a guessed filename.

## Domain playbooks

Load these for detailed patterns as you author each artifact:
- `/kickstart-bicep-authoring` — Bicep template structure and conventions
- `/kickstart-workload-identity` — federated credentials, service-account wiring, pod labels
- `/kickstart-acr-integration` — attaching ACR to the cluster (no pull secrets)

## Artifacts

**Dockerfile**: Multi-stage build, pinned base image (never `:latest`), non-root user, `.dockerignore`. `COPY`/`ADD` paths validated against the build context; `CMD` runs the real entry point.

**K8s Manifests** (`k8s/`): `namespace.yaml`, `deployment.yaml` (resource requests **and** limits, probes, `runAsNonRoot`, Workload Identity labels, env from ConfigMap/Secret), `service.yaml` (ClusterIP), `httproute.yaml` (Gateway API, not Ingress). See `/kickstart-workload-identity`.

### Generate safeguard-compliant manifests up front

AKS Automatic enforces **Deployment Safeguards**, and several of them *mutate* your manifest on apply. If you don't emit these yourself, the cluster silently rewrites the object and the Phase 7 `kubectl get`/`diff` output won't match what you generated. Emit all of the following by default — see `/kickstart-safeguard-checklist` for the authoritative rule list and mutation outcomes.

- **CPU + memory `requests` on every container** (mutating if omitted), alongside limits:
  ```yaml
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits:   { cpu: 500m, memory: 512Mi }
  ```
- **`topologySpreadConstraints` or pod anti-affinity** (mutating if omitted). Prefer topology spread:
  ```yaml
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway
      labelSelector:
        matchLabels: { app: <service> }
  ```
- **Readiness *and* liveness probes** on every container — use the real health path and port from the structure map, never a guessed `/healthz`.
- **Unique Service selectors** — each Service must select exactly one workload. In a monorepo do **not** reuse `app: <appName>` across services; use `app: <serviceName>` (or `app.kubernetes.io/name` + `app.kubernetes.io/component`) so no two Services overlap.
- **No AKS-specific labels** — never set `kubernetes.azure.com/*` labels on your own objects. (`azure.workload.identity/*` labels and annotations are fine and required.)
- **No reserved system-pool taints/tolerations** — do not add a `CriticalAddonsOnly` toleration to app pods; it would place them on the system pool and AKS strips it anyway.
- **CSI StorageClass for any PVC** — set `storageClassName` explicitly to a CSI class (`managed-csi`, `managed-csi-premium`, `azurefile-csi`); never rely on an in-tree or unset default.
- **Pinned image tags** — no `:latest` anywhere, including init containers and sidecars.
- **Allowed images only** — every image must come from the Phase 2 ACR (`<acr>.azurecr.io/...`) if the cluster restricts registries; flag any third-party image (Redis, Postgres, RabbitMQ) that would need importing via `az acr import`.
- **Never edit individual nodes** — no node-targeted manifests, `kubectl label node`, `kubectl taint node`, or node-name `nodeSelector`. Use node pools instead.

**Bicep** (`infra/main.bicep`): AKS Automatic + ACR + Managed Identity + federated credential. Parameterized, pinned API versions. ARM resource IDs follow `/subscriptions/{sub}/resourceGroups/{rg}/providers/{ns}/{type}/{name}`. See `/kickstart-bicep-authoring` and `/kickstart-acr-integration`.

**GitHub Actions** (`.github/workflows/deploy.yml`): OIDC auth (no secrets), build+push to ACR, deploy to AKS, minimal `permissions`, environment protection. Use federated credentials with `azure/login@v2`.

## Rules
- Use actual resource names from the Configure phase.
- Never use `:latest` tags.
- Honor each service's build context and entry point from the structure map; reuse existing Dockerfiles instead of duplicating them.
- All K8s manifests must comply with AKS deployment safeguards (restricted pod security, no privileged, no hostPath) **and** must pre-satisfy the mutating safeguards above so the cluster doesn't rewrite them on apply.
- Build images with `az acr build` only — never `docker build`.
- After writing all files, confirm with user via `vscode_askQuestions`.

## Validate the build (before exit)

Do not hand off unbuilt artifacts. Build every Dockerfile with **`az acr build`** — server-side on the ACR remote task builders. Never `docker build`; there is no Docker daemon in Cloud Shell, and one build path keeps the validated image and the deployed image identical.

1. **Build in ACR** from the service's own build context. This also catches missing `COPY`/`ADD` sources:
   ```bash
   az acr build --registry <acr> --image kickstart-validate/<svc>:check -f <dockerfilePath> <buildContext>
   ```
2. **Assert the entry point at build time.** Add to the Dockerfile's final stage so a wrong path fails the ACR build itself:
   ```dockerfile
   RUN test -f <entrypointPath>
   ```
   The assertion runs before the cluster exists, so a wrong path is caught immediately.
3. If the build fails or the assertion trips, fix the Dockerfile/paths and rebuild — do not proceed to Review with a broken image.

Keep `.dockerignore` tight: the entire build context is uploaded to ACR on every build.

## Exit Criteria
All artifacts written, every Dockerfile builds via `az acr build`, and the build-time entry-point assertion passes. Announce: "Artifacts generated and build-validated — moving to Review."
