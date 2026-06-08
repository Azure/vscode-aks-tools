# Agents

This extension contributes one user-invocable Copilot chat agent (`kickstart`) plus three internal subagents that it orchestrates. They have no runtime TypeScript code — behavior is entirely driven by markdown prompts and skill invocations. Cross-agent state is passed in subagent prompts and return values; the parent tracks visible progress with `manage_todo_list`. No state file is written.

## Topology

```
User selects "kickstart" in Copilot
        │
        ▼
   kickstart  ─── Phase 1 Discover ───►─── Phase 2 Configure ───┐
        │                                                       │
        │   (after Configure, automatically — no user click)    │
        │                                                       ▼
        ├──── invokes ──────────────────►  kickstart-builder (subagent)
        │                                       │
        │                                       ▼ returns {status}
        ├──── invokes ──────────────────►  kickstart-reviewer (subagent)
        │                                       │
        │                                       ▼ returns {status}
        └──── invokes ──────────────────►  kickstart-deployer (subagent)
                                                │
                                                ▼ returns {status, appUrl?}
                                          (final status pill)
```

There are **no handoff buttons** between phases. The three sub-agents are pure subagents — invoked via the `agent` tool from `kickstart`, they execute, and they return a structured JSON summary. The orchestrator branches on `status` to decide what to invoke next.

State is **not** persisted to disk. The parent (`kickstart`) tracks phase progress with the native `manage_todo_list` (7 items) and keeps an in-context JSON state object in its own chat history. It embeds that state as a fenced JSON block in every subagent prompt; each subagent returns a `stateDelta` JSON block in its final message; the parent shallow-merges and continues. Resume after chat restart re-derives from workspace artifacts + one `az aks show`. See [skills/kickstart-state/SKILL.md](skills/kickstart-state/SKILL.md) for the schema and channels.

## kickstart

**File**: [agents/kickstart.agent.md](agents/kickstart.agent.md)
**User-invocable**: Yes (gated by `aks.kickstart.enabled` setting)
**Owns**: Welcome, Phase 1 Discover, Phase 2 Configure, **and orchestration of phases 3–7 via subagent invocations**, plus the 7-item `manage_todo_list` visible progress UI and the in-context state object
**Tools**: editFiles, search, codebase, fetch, runCommands, problems, usages, vscode_askQuestions, run_in_terminal, get_terminal_output, send_to_terminal, kill_terminal, manage_todo_list, **agent**
**Subagents (allowlisted)**: `aks/kickstart-builder`, `aks/kickstart-reviewer`, `aks/kickstart-deployer`

Greets the user, runs Discover, runs Configure (provider checks, quota-aware region pick, `az group/aks/acr create` with `--no-wait`), then in the same turn calls each of the three subagents in sequence via the `agent` tool. Inspects each subagent's `status` return value and either continues, retries, or surfaces a recovery choice to the user. The user sees three collapsible subagent tool calls in the chat — no buttons to click between them.

## kickstart-builder

**File**: [agents/kickstart-builder.agent.md](agents/kickstart-builder.agent.md)
**User-invocable**: No (only invoked as subagent by `kickstart`)
**Owns**: Phase 3 Design, Phase 4 Generate
**Tools**: editFiles, search, codebase, fetch, run_in_terminal (client-side dry-runs only), get_terminal_output, problems, usages, vscode_askQuestions (used once for design approval)

The only subagent that writes deployment artifacts. Proposes the architecture (one `vscode_askQuestions` for accept / change / abort), then emits Dockerfile, `k8s/`, `infra/main.bicep`, and `.github/workflows/deploy.yml`. May run `kubectl apply --dry-run=client` and `az bicep build` for local lints but never touches the live cluster. Returns `{ status: 'ok' | 'changed' | 'failed', files, … }`.

## kickstart-reviewer

**File**: [agents/kickstart-reviewer.agent.md](agents/kickstart-reviewer.agent.md)
**User-invocable**: No (only invoked as subagent by `kickstart`)
**Owns**: Phase 5 Review
**Tools**: search, codebase, problems, usages, vscode_askQuestions (unused on happy path), run_in_terminal (read-only validation), get_terminal_output

Validates every generated artifact against safeguard rules (DS001–DS013) and security defaults. No `editFiles`, no destructive `az`/`kubectl`. Returns `{ status: 'pass' | 'warn' | 'fail', failures, warnings }`. Does NOT call `vscode_askQuestions` itself — the parent surfaces the warn/fail branch decision to the user.

## kickstart-deployer

**File**: [agents/kickstart-deployer.agent.md](agents/kickstart-deployer.agent.md)
**User-invocable**: No (only invoked as subagent by `kickstart`)
**Owns**: Phase 6 Pre-Deploy, Phase 7 Deploy
**Tools**: run_in_terminal, get_terminal_output, send_to_terminal, kill_terminal, terminal read tools, problems, vscode_askQuestions (used only for PIM activation choice) — **no `editFiles`**

The only subagent with destructive runtime power. Runs the 6a–6g pre-deploy gauntlet (cluster ready, metadata, ACR attach with three-tier fallback including PIM, kubelogin, control-plane probe, data-plane RBAC probes with self-remediation, ACR push pre-check), then executes the deploy (`az acr build`, `az aks get-credentials`, `kubectl apply`, verify). Each destructive command is gated by VS Code's own per-command terminal approval — there are no extra `vscode_askQuestions` prompts wrapped around them. Returns `{ status: 'succeeded' | 'failed', appUrl?, errorClass? }`.

## Entry Points

| Method | Command/Action | Effect |
|---|---|---|
| Agent picker | Select "kickstart" in Copilot dropdown | Starts Phase 1; the three sub-agents are hidden from the dropdown since they have `user-invocable: false` |
| Command palette | `AKS: Launch Kickstart Agent` (`aks.kickstartFocus`) | Hides sidebar/panel, opens chat, invokes kickstart |
| Prompt file | `kickstart.prompt.md` | Lightweight discovery flow |

## Consent Model (User Clicks)

On the happy path, the user is asked to consent only:

1. **Once** at Welcome (workflow picker).
2. **Once** during Discover, only for fields auto-detection couldn't fill.
3. **Once** at Configure to confirm the active **tenant** (only when more than one is visible).
4. **Once** at Configure to confirm the active **subscription** (always — single-option prompt when only one exists).
5. **Once** at Configure to pick the **resource strategy** — use existing / mixed / create new — plus picker prompts for each existing RG / AKS / ACR when applicable.
6. **Once** at Configure for the region + RG/AKS/ACR name form (only when creating new resources).
7. **Once** inside the builder subagent for design approval.
8. **Per destructive terminal command** — VS Code's built-in terminal approval UI prompts for each `az group/aks/acr create`, `az aks update --attach-acr`, `az role assignment create`, `az acr build`, `az aks get-credentials`, and `kubectl apply`.

Read-only `az ...show/list`, `kubectl get`, `kubectl auth can-i`, etc. auto-approve via the allowlist in [package.json](package.json) (`chat.tools.terminal.autoApprove`). There are no "Shall I proceed?" gates and no handoff buttons.

## Skills

22 skills in `skills/` provide domain knowledge and shared contracts to the agents. All use `disable-model-invocation: true` (only fire when explicitly invoked). Categorized as:

- **Shared contract (1)**: `kickstart-state` — defines the 7-item `manage_todo_list` and the in-context `stateDelta` JSON exchange format used between parent and subagents
- **Phase skills (6)**: One per phase — `kickstart-discover`, `kickstart-design`, `kickstart-generate`, `kickstart-review`, `kickstart-predeploy`, `kickstart-deploy`
- **Domain skills (10)**: `kickstart-acr-integration`, `kickstart-bicep-authoring`, `kickstart-github-actions-oidc`, `kickstart-github-actions-workflow`, `kickstart-github-pr-conventions`, `kickstart-kaito-gpu`, `kickstart-pim-activation`, `kickstart-samples`, `kickstart-security-hardening`, `kickstart-workload-identity`
- **Behavioral skills (4)**: `kickstart-phase-acceleration`, `kickstart-collaborator-voice`, `kickstart-file-generation`, `kickstart-terminal-conventions`
- **Validation skill (1)**: `kickstart-safeguard-checklist` — DS001–DS013
