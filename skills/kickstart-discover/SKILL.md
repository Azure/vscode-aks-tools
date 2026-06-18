---
name: kickstart-discover
description: "Discovery phase playbook — collect application details."
disable-model-invocation: true
---

# Discover Phase

Collect enough information to propose a deployment architecture.

## Auto-detect first, then ask

Use `search` and `codebase` to scan the workspace before asking anything. Look for `package.json`, `requirements.txt`, `go.mod`, `*.csproj`, `Dockerfile`, `.github/workflows/`, `azure-pipelines.yml`.

## What to collect

- App name
- Language / framework (detect from manifest files, confirm via `vscode/askQuestions`)
- Dependencies (databases, caches, queues — offer common options as multi-select)
- Port (detect from code like `app.listen(3000)`, confirm)
- Environment variables (detect from `.env.example` or code)
- Existing Dockerfile (search workspace)
- Existing CI/CD (search workspace)

## Rules

- Use `vscode/askQuestions` for every question with concrete options. Mark detected/recommended values with `recommended: true`.
- One question at a time unless tightly related.
- When the answer is open-ended (app name), use `allowFreeformInput: true`.

## Exit Criteria
You know the app name, language, framework, port, key deps, env vars, and Dockerfile/CI status. Announce: "Discovery complete — moving to Configure Infrastructure."
