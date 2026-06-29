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
- **Cross-check every `COPY`/`ADD`.** Each source must resolve to a real file/dir inside that service's build context, and the destination must match where the entry point runs (e.g. `WORKDIR /app` + `COPY . /app` only if the entry point is at the context root). Use `search`/`search/codebase` to confirm sources exist before writing the Dockerfile; flag and fix any mismatch.
- **Set the run target from the real entry point** (`CMD`/`ENTRYPOINT`), not a guessed filename.

## Domain playbooks

Load these for detailed patterns as you author each artifact:
- `/kickstart-bicep-authoring` — Bicep template structure and conventions
- `/kickstart-workload-identity` — federated credentials, service-account wiring, pod labels
- `/kickstart-acr-integration` — attaching ACR to the cluster (no pull secrets)

## Artifacts

**Dockerfile**: Multi-stage build, pinned base image (never `:latest`), non-root user, `.dockerignore`. `COPY`/`ADD` paths validated against the build context; `CMD` runs the real entry point.

**K8s Manifests** (`k8s/`): `namespace.yaml`, `deployment.yaml` (resource limits, probes, `runAsNonRoot`, Workload Identity labels, env from ConfigMap/Secret), `service.yaml` (ClusterIP), `httproute.yaml` (Gateway API, not Ingress). See `/kickstart-workload-identity`.

**Bicep** (`infra/main.bicep`): AKS Automatic + ACR + Managed Identity + federated credential. Parameterized, pinned API versions. ARM resource IDs follow `/subscriptions/{sub}/resourceGroups/{rg}/providers/{ns}/{type}/{name}`. See `/kickstart-bicep-authoring` and `/kickstart-acr-integration`.

**GitHub Actions** (`.github/workflows/deploy.yml`): OIDC auth (no secrets), build+push to ACR, deploy to AKS, minimal `permissions`, environment protection. Use federated credentials with `azure/login@v2`.

## Rules
- Use actual resource names from the Configure phase.
- Never use `:latest` tags.
- Honor each service's build context and entry point from the structure map; reuse existing Dockerfiles instead of duplicating them.
- All K8s manifests must comply with AKS deployment safeguards (restricted pod security, no privileged, no hostPath).
- After writing all files, confirm with user via `vscode/askQuestions`.

## Validate the build (before exit)

Do not hand off unbuilt artifacts. For each Dockerfile, build and inspect before announcing completion:

1. **Build** from the service's build context:
   - Local Docker/Podman daemon available: `docker build -t kickstart-validate-<svc>:check -f <dockerfilePath> <buildContext>`.
   - Otherwise build in ACR (also catches missing `COPY` sources): `az acr build --registry <acr> --image kickstart-validate/<svc>:check -f <dockerfilePath> <buildContext>`.
2. **Inspect contents** (when built locally): `docker run --rm kickstart-validate-<svc>:check ls -la <workdir>` — confirm the entry point and expected files landed where the app runs from. A build that succeeds but places files in the wrong dir is exactly the failure this step catches.
3. If the build fails or the entry point is missing, fix the Dockerfile/paths and rebuild — do not proceed to Review with a broken image.

## Exit Criteria
All artifacts written, every Dockerfile builds, and the entry point is confirmed present in the image. Announce: "Artifacts generated and build-validated — moving to Review."
