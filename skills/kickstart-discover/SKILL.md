---
name: kickstart-discover
description: "Discovery phase playbook — collect application details."
disable-model-invocation: true
---

# Discover Phase

Collect enough information to propose a deployment architecture.

## Auto-detect first, then ask

Use `search` and `search/codebase` to scan the workspace before asking anything. Look for `package.json`, `requirements.txt`, `go.mod`, `*.csproj`, `Dockerfile`, `.github/workflows/`, `azure-pipelines.yml`.

## Map the structure (before anything else)

Never assume a flat repo. Apps often live in nested or monorepo layouts (`src/<service>/`, `services/<name>/`, `apps/<name>/`, `packages/<name>/`). For **every deployable service**, record a structure entry — later phases build and deploy from it:

| Field | How to find it | Used by |
|---|---|---|
| Service name | directory / manifest | naming, image tag |
| Build context | the dir holding the service's manifest + source (NOT always repo root) | Generate, Deploy build context |
| Entry point | the real run target — `main.py`, `app.js`, `cmd/<svc>/main.go`, `*.csproj` — confirm the file exists | Dockerfile `CMD`/`ENTRYPOINT` |
| Existing Dockerfile | search the build context; record its path or "none — generate" | Generate (reuse vs. create) |
| Port | code (`app.listen(3000)`, `EXPOSE`, framework default) | Service, probes |

Use `search/codebase`/`search` to confirm each path actually exists — do not infer it from the language alone. Surface this map to the user and let them correct it before proceeding.

## What to collect

- App name
- Language / framework (detect from manifest files, confirm via `vscode/askQuestions`)
- Per-service structure map (build context, entry point, existing Dockerfile path) — see above
- Dependencies (databases, caches, queues — offer common options as multi-select)
- Port (detect from code like `app.listen(3000)`, confirm)
- Environment variables (detect from `.env.example` or code)
- Existing CI/CD (search workspace)

## Rules

- Use `vscode/askQuestions` for every question with concrete options. Mark detected/recommended values with `recommended: true`.
- One question at a time unless tightly related.
- When the answer is open-ended (app name), use `allowFreeformInput: true`.

## Exit Criteria
You know the app name, language, framework, port, key deps, env vars, CI status, and a confirmed per-service structure map (build context + entry point + existing Dockerfile path) for every deployable service. Announce: "Discovery complete — moving to Configure Infrastructure."
