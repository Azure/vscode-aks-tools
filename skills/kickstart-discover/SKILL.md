---
name: kickstart-discover
description: "Discovery phase playbook — collect application details."
disable-model-invocation: true
---

# Discover Phase

Collect enough information to propose a deployment architecture.

## Auto-detect first, then ask

Use `search` and `codebase` to scan the workspace before asking anything. Look for `package.json`, `requirements.txt`, `go.mod`, `*.csproj`, `Dockerfile`, `.github/workflows/`, `azure-pipelines.yml`.

## Map the structure (before anything else)

Never assume a flat repo. Apps often live in nested or monorepo layouts (`src/<service>/`, `services/<name>/`, `apps/<name>/`, `packages/<name>/`). For **every deployable service**, record a structure entry — later phases build and deploy from it:

| Field | How to find it | Used by |
|---|---|---|
| Service name | directory / manifest | naming, image tag |
| Build context | the dir holding the service's manifest + source (NOT always repo root) | Generate, Deploy build context |
| Entry point | the real run target — `main.py`, `app.js`, `cmd/<svc>/main.go`, `*.csproj` — confirm the file exists | Dockerfile `CMD`/`ENTRYPOINT` |
| Existing Dockerfile | search the build context; record its path or "none — generate" | Generate (reuse vs. create) |
| Port | code (`app.listen(3000)`, `EXPOSE`, framework default) | Service, probes |

Use `codebase`/`search` to confirm each path actually exists — do not infer it from the language alone. Surface this map to the user and let them correct it before proceeding.

## Build environment

All container images are built with **`az acr build`** — server-side on the ACR remote task builders. Never `docker build`. Kickstart runs in Azure Cloud Shell, which has no Docker daemon, and a single remote build path keeps behavior identical everywhere.

Cloud Shell constraints to honor:

- Clone into `~/clouddrive/` (persistent, ~5 GB) rather than the ephemeral home dir.
- `az acr build` needs the Phase 2 ACR to exist and the caller to hold `AcrPush` (or `Container Registry Tasks Contributor`) — see `/kickstart-handoff`.
- Keep `az acr build` in the foreground so its streamed log holds an idle session open, and keep `.dockerignore` tight (the whole build context uploads on every build).

## What to collect

- App name
- Language / framework (detect from manifest files, confirm via `vscode_askQuestions`)
- Per-service structure map (build context, entry point, existing Dockerfile path) — see above
- Dependencies (databases, caches, queues — offer common options as multi-select)
- Port (detect from code like `app.listen(3000)`, confirm)
- Environment variables (detect from `.env.example` or code)
- Existing CI/CD (search workspace)

## Rules

- Use `vscode_askQuestions` for every question with concrete options. Mark detected/recommended values with `recommended: true`.
- One question at a time unless tightly related.
- When the answer is open-ended (app name), use `allowFreeformInput: true`.

## Exit Criteria
You know the app name, language, framework, port, key deps, env vars, CI status, a confirmed per-service structure map (build context + entry point + existing Dockerfile path) for every deployable service. Announce: "Discovery complete — moving to Configure Infrastructure."
