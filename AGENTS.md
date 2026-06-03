# Agents

This extension contributes four declarative Copilot chat agents defined in `agents/`. They have no runtime TypeScript code — behavior is entirely driven by markdown prompts, skill invocations, and a shared state file at `.kickstart/state.json`.

## Topology

```
User selects "kickstart" in Copilot
        │
        ▼
   kickstart  ──Design & Generate──►  kickstart-builder
        ▲                                     │
        │                              Review Artifacts
        │                                     ▼
        │                            kickstart-reviewer
        │                                     │
        │     ┌──Fix and Regenerate───────────┤
        │     │                               │
        │     ▼                        Proceed to Deploy
        │  (builder)                          ▼
        │                            kickstart-deployer
        └─── Back to Kickstart ──────────────┘
              (on auth/config issue)
```

All four agents read `.kickstart/state.json` on entry and write it on exit. See [skills/kickstart-state/SKILL.md](skills/kickstart-state/SKILL.md) for the schema.

## kickstart

**File**: [agents/kickstart.agent.md](agents/kickstart.agent.md)
**User-invocable**: Yes (gated by `aks.kickstart.enabled` setting)
**Owns**: Welcome, Phase 1 Discover, Phase 2 Configure
**Tools**: editFiles, search, codebase, fetch, runCommands, problems, usages, vscode_askQuestions, run_in_terminal, get_terminal_output, send_to_terminal, kill_terminal
**Handoffs**: → `kickstart-builder` (forward), → `kickstart-reviewer`/`kickstart-deployer` (re-entry after downstream fix)

The orchestrator. Greets the user, runs Discover, runs Configure (provider checks, quota-aware region pick, `az group/aks/acr create` with `--no-wait`), then hands off to the builder. Also serves as the fallback when a downstream agent bounces work back due to an out-of-scope issue.

## kickstart-builder

**File**: [agents/kickstart-builder.agent.md](agents/kickstart-builder.agent.md)
**User-invocable**: No (reached via handoff from `kickstart`)
**Owns**: Phase 3 Design, Phase 4 Generate
**Tools**: editFiles, search, codebase, fetch, run_in_terminal (client-side dry-runs only), get_terminal_output, problems, usages, vscode_askQuestions
**Handoffs**: → `kickstart-reviewer` (forward), → `kickstart` (escalation)

The only agent that writes deployment artifacts. Proposes the architecture, gets approval, then emits Dockerfile, `k8s/`, `infra/main.bicep`, and `.github/workflows/deploy.yml`. May run `kubectl apply --dry-run=client` and `az bicep build` for local lints but never touches the live cluster.

## kickstart-reviewer

**File**: [agents/kickstart-reviewer.agent.md](agents/kickstart-reviewer.agent.md)
**User-invocable**: No (reached via handoff from `kickstart-builder`)
**Owns**: Phase 5 Review
**Tools**: search, codebase, problems, usages, vscode_askQuestions, run_in_terminal (read-only validation), get_terminal_output
**Handoffs**: → `kickstart-deployer` (pass), → `kickstart-builder` (fail), → `kickstart` (escalation)

Validates every generated artifact against safeguard rules (DS001–DS013) and security defaults. No `editFiles`, no destructive `az`/`kubectl`. Pass/fail/warn checklist drives the next handoff.

## kickstart-deployer

**File**: [agents/kickstart-deployer.agent.md](agents/kickstart-deployer.agent.md)
**User-invocable**: No (reached via handoff from `kickstart-reviewer`)
**Owns**: Phase 6 Pre-Deploy, Phase 7 Deploy
**Tools**: run_in_terminal, get_terminal_output, send_to_terminal, kill_terminal, terminal read tools, problems, vscode_askQuestions — **no `editFiles`**
**Handoffs**: → `kickstart` (config issue), → `kickstart-reviewer` (re-review)

The only agent with destructive runtime power. Runs the 6a–6g pre-deploy gauntlet (cluster ready, metadata, ACR attach with three-tier fallback including PIM, kubelogin, control-plane probe, data-plane RBAC probes with self-remediation, ACR push pre-check), then executes the deploy (`az acr build`, `az aks get-credentials`, `kubectl apply`, verify).

## Entry Points

| Method | Command/Action | Effect |
|---|---|---|
| Agent picker | Select "kickstart" in Copilot dropdown | Starts Phase 1; the three sub-agents are filtered out by Copilot since they have `user-invocable: false` |
| Command palette | `AKS: Launch Kickstart Agent` (`aks.kickstartFocus`) | Hides sidebar/panel, opens chat, invokes kickstart |
| Prompt file | `kickstart.prompt.md` | Lightweight discovery flow |

## Skills

31 skills in `skills/` provide domain knowledge and shared contracts to the agents. All use `disable-model-invocation: true` (only fire when explicitly invoked). Categorized as:

- **Shared contract (1)**: `kickstart-state` — defines `.kickstart/state.json` schema and read/write helpers
- **Phase skills (6)**: One per phase — step-by-step playbooks
- **Domain skills (19)**: AKS Automatic, Gateway API, Workload Identity, Bicep, networking, cost estimation, PIM activation, etc.
- **Behavioral skills (4)**: Phase acceleration, teach-then-ask, collaborator voice, file generation batching
- **Validation skill (1)**: Safeguard checklist (DS001–DS013)
