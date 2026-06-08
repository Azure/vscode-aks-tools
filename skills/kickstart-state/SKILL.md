---
name: kickstart-state
description: "How Kickstart tracks progress and hands off between sub-agents without persisting a state file. Uses the native todo list for visible progress and inline JSON for cross-agent handoff."
disable-model-invocation: true
---

# Kickstart Progress & State Contract

Kickstart tracks progress through two native chat-surface channels — no disk persistence:

1. **`manage_todo_list`** — a 7-item checklist the parent (`kickstart`) maintains. This is the user-facing progress UI.
2. **Inline JSON in agent prompts and return values** — the parent embeds the current state JSON in each subagent prompt; subagents return a `stateDelta` JSON block in their final message. The parent merges deltas into its in-context state object (chat history is the parent's memory).

## Why no file

- Writing state to disk in shell would hit the terminal allowlist denies for `>`, `&&`, `mkdir`, `jq`, `mv` — producing an approval prompt every phase.
- The parent's own chat history already retains everything it decided. A file just duplicates that.
- Subagent handoff has explicit channels (prompt in, structured return out). A file is a side channel that gets out of sync.
- Resume after chat restart re-derives cheaply from workspace artifacts plus one `az` probe (see *Resuming* below).

## Channel 1 — Todo List (Parent Only)

On Welcome, after the user picks a workflow, the parent seeds the todo list with these seven items in this order:

| # | Title |
|---|---|
| 1 | Discover app |
| 2 | Configure Azure resources |
| 3 | Design target architecture |
| 4 | Generate deployment artifacts |
| 5 | Review artifacts |
| 6 | Pre-deploy checks |
| 7 | Deploy to AKS |

Status transitions:

- Mark the active item `in-progress` when the parent enters that phase (or invokes the subagent that owns it).
- Mark it `completed` immediately on success, before invoking the next subagent.
- On a subagent failure that requires backtracking (reviewer fails → re-invoke builder), revert item N to `in-progress` and leave later items `not-started`.

Only one item is `in-progress` at any moment. **Subagents must not call `manage_todo_list`** — only the parent does. Single writer keeps the list coherent.

## Channel 2 — In-Context State JSON (Cross-Agent Handoff)

The parent keeps a running JSON state object in its own context (visible in its own chat history). Schema:

```json
{
  "app": {
    "name": "",
    "language": "",
    "framework": "",
    "port": null,
    "deps": [],
    "envVars": [],
    "existingDockerfile": false,
    "existingCi": false,
    "projectRoot": "."
  },
  "azure": {
    "subscriptionId": "",
    "tenantId": "",
    "resourceGroup": "",
    "cluster": "",
    "acr": "",
    "region": "",
    "namespace": ""
  },
  "cluster": {
    "provisioningState": "Unknown",
    "acrAttached": false,
    "kubeloginInstalled": null,
    "controlPlaneOk": null,
    "dataPlaneOk": null,
    "acrPushOk": null
  },
  "artifacts": {
    "dockerfile": null,
    "dockerignore": null,
    "k8s": [],
    "bicep": [],
    "workflow": null
  },
  "review": { "status": "pending", "failures": [], "warnings": [] },
  "deploy": { "imageTag": null, "lastStep": null, "status": "pending", "error": null }
}
```

### Parent → Subagent (inline in the agent prompt)

When invoking any subagent via the `agent` tool, embed the current state as a fenced JSON block at the top of the prompt:

> Take the following state and execute your phase. Return a `stateDelta` along with `status` in your final message.
>
> ```json
> { "app": {...}, "azure": {...}, "cluster": {...}, "artifacts": {...}, "review": {...}, "deploy": {...} }
> ```
>
> (then the task-specific instructions)

Subagents read this directly from their prompt — no file I/O, no separate read step.

### Subagent → Parent (`stateDelta` in the final message)

Every subagent's final message ends with one fenced JSON block of this exact shape:

```json
{
  "status": "ok | changed | failed | pass | warn | fail | succeeded",
  "stateDelta": {
    "artifacts": { "...": "..." },
    "cluster":   { "...": "..." },
    "review":    { "...": "..." },
    "deploy":    { "...": "..." }
  }
}
```

The parent does a shallow merge of `stateDelta` into the running state object, then invokes the next subagent (or branches per `status`).

Ownership — what each subagent may put in `stateDelta`:

| Section | Owner |
|---|---|
| `app` | parent (Discover) |
| `azure` | parent (Configure) |
| `cluster` | parent (early peek) + `kickstart-deployer` (probes) |
| `artifacts` | `kickstart-builder` |
| `review` | `kickstart-reviewer` |
| `deploy` | `kickstart-deployer` |

Subagents must only emit deltas in their owned sections. Do not invent fields.

## Resuming After Chat Restart

When a fresh `kickstart` turn starts with no prior context, infer progress from the workspace and one Azure probe — no file read.

1. **Workspace scan** (read-only, instant, no approval needed via `search`/`read_file`):
   - `Dockerfile` and `.dockerignore` present → Phase 4 (Generate) done.
   - `k8s/*.yaml` present → Phase 4 done.
   - `infra/main.bicep` present → Phase 4 done.
   - `.github/workflows/deploy.yml` present → Phase 4 done.
2. **Azure probe** — only if step 1 suggests Generate completed. Use one allowlisted call: `az aks list --query "[].{name:name,rg:resourceGroup,state:provisioningState}" -o json`. If a cluster matches the app naming pattern, treat Configure as done.
3. **Cluster probe** — `kubectl get deploy -n <ns> <app> -o name` if kubeconfig already has a matching context. A hit means Phase 7 ran.

Confirm with one `vscode_askQuestions`: "It looks like you already completed up to **<phase>**. Resume from there?" Options: *Yes, resume*, *Restart from Discover*, *Inspect existing deployment*.

If the workspace has none of the artifacts, treat as a fresh run.

## Status Pill (Optional)

When the parent prints a one-line status, derive it from the in-context state — no file needed:

`[Phase: <next-todo> · Cluster: <provisioningState> · ACR: <attached|not attached> · Artifacts: <count>]`

The todo list is the source of truth for progress; the pill is decorative.
