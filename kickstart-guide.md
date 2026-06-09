# Kickstart Extension Guide

How the Kickstart VS Code extension works — agents, skills, orchestration, and the phase machine.

## Architecture

Kickstart is a VS Code Copilot extension that uses **declarative agents and skills** (no runtime code). Everything is contributed via `package.json` using the `chatAgents` and `chatSkills` contribution points from the `chatParticipantAdditions` proposed API.

The flow is split across one user-invocable agent (`kickstart`) and **three internal subagents** it orchestrates. The parent tracks visible progress with `manage_todo_list` (7 items) and keeps an in-context JSON state object that it embeds in every subagent prompt; subagents return a `stateDelta` JSON block in their final message. No state file is written.

```
User selects "kickstart" agent in Copilot
        │
        ▼
  kickstart  ─── Phase 1 Discover ──►── Phase 2 Configure ───┐
        │                                                    │
        │   (after Configure, automatically — no user click) │
        │                                                    ▼
        ├──── invokes ──────────────────►  kickstart-builder (subagent)
        │                                       │
        │                                       ▼ returns {status, stateDelta}
        ├──── invokes ──────────────────►  kickstart-reviewer (subagent)
        │                                       │
        │                                       ▼ returns {status, stateDelta}
        └──── invokes ──────────────────►  kickstart-deployer (subagent)
                                                │
                                                ▼ returns {status, appUrl?}
                                          (final status pill)
```

There are no handoff buttons. Subagent invocations are fully automatic — the parent calls each subagent via the `agent` tool, merges the returned `stateDelta` into its in-context state, then either continues, retries, or surfaces a recovery choice. See [skills/kickstart-state/SKILL.md](skills/kickstart-state/SKILL.md) for the schema and exchange format.

## Feature Gate

All agents are gated by a VS Code setting:

```json
"aks.kickstart.enabled": true  // default
```

The four `chatAgents` entries use `"when": "config.aks.kickstart.enabled == true"`. Only `kickstart` appears in the Copilot agent picker — the three sub-agents have `user-invocable: false` in their frontmatter and are only reachable via the parent's `agent` tool invocations.

## Entry Points

| Entry Point | How | What happens |
|---|---|---|
| **Agent picker** | User selects "kickstart" in Copilot's agent dropdown | Full orchestrator prompt loads, starts at Welcome → Phase 1 |
| **Command palette** | User runs `AKS: Launch Kickstart Agent` (`aks.kickstartFocus`) | Hides sidebar/panel, opens chat, sends initial message to kickstart agent |
| **Prompt file** | User runs `kickstart.prompt.md` from the prompt picker | Lightweight version — invokes `/kickstart-discover` and starts the flow |

## Orchestration

After Configure (Phase 2), the parent invokes the three subagents in sequence in the same turn — no user clicks between phases. Each invocation embeds the current in-context state as a fenced JSON block in the prompt; each subagent returns `status` and `stateDelta` in its final message. The parent shallow-merges the delta, advances `manage_todo_list`, and branches on `status`.

### Forward invocations

| Step | Invoked subagent | Trigger | Happy-path `status` |
|---|---|---|---|
| A | `kickstart-builder` | End of Configure; state has `app.*` + `azure.*` populated | `ok` → continue to B |
| B | `kickstart-reviewer` | End of Generate; state has `artifacts.*` populated | `pass` → continue to C |
| C | `kickstart-deployer` | Review returned `pass` (or user accepted `warn`) | `succeeded` → render final pill |

### Recovery branches (parent-owned)

When a subagent returns a non-happy `status`, the parent decides what to do — there are no back-edges initiated by the subagents themselves.

| Returned `status` | Parent action |
|---|---|
| `builder: changed` | Revert affected todo to `in-progress`, re-run the Discover/Configure step the builder flagged, then re-invoke builder |
| `builder: failed` | Surface the blocker via `vscode_askQuestions` with concrete recovery options |
| `reviewer: warn` | Surface accept-and-deploy vs fix-first to the user via `vscode_askQuestions` |
| `reviewer: fail` | Re-invoke builder with the failure list (loop at most twice, then escalate) |
| `deployer: failed` (auth/PIM) | Re-invoke deployer after the PIM activation the user picked inline |
| `deployer: failed` (config) | Re-run Configure for the missing field, then re-invoke deployer |
| `deployer: failed` (cluster) | Re-invoke reviewer with the runtime failure for analysis |

## State Contract

The parent keeps a JSON state object in its own chat history (no file on disk). On each subagent invocation, the parent embeds the current state as a fenced JSON block in the prompt. Subagents return a `stateDelta` JSON block in their final message; the parent shallow-merges. Defined in `/kickstart-state`. Sections and owners:

| Section | Owner |
|---|---|
| `app.*` | `kickstart` (Discover) |
| `azure.*` | `kickstart` (Configure) |
| `cluster.*` | `kickstart` (peek), `kickstart-deployer` (full probes) |
| `artifacts.*` | `kickstart-builder` |
| `review.*` | `kickstart-reviewer` |
| `deploy.*` | `kickstart-deployer` |

Visible progress is tracked by `manage_todo_list` (7 items, one per phase). On session restart with no in-context state, the parent re-derives progress by scanning the workspace (`Dockerfile`, `k8s/`, `infra/`, `.github/workflows/`) and probing Azure with one `az aks list`. The status pill on re-entry: `[Phase: deploy · Cluster: Succeeded · ACR: attached · Artifacts: 7]`.

## Phase Machine

Seven phases in strict order, owned by four agents. Each phase has a dedicated **phase skill** with the playbook.

| Phase | Owner agent | Skill | What it does | Exit criteria |
|---|---|---|---|---|
| 1. Discover | `kickstart` | `/kickstart-discover` | Collect app name, language, framework, deps, port, env vars, Dockerfile/CI status | Enough info to propose architecture |
| 2. Configure | `kickstart` | (inline in agent) | Create or select Azure resources (RG, AKS cluster, ACR). Cluster creates with `--no-wait` | Resources selected/creating |
| 3. Design | `kickstart-builder` | `/kickstart-design` | Propose AKS Automatic architecture, get user approval | User approves |
| 4. Generate | `kickstart-builder` | `/kickstart-generate` | Create Dockerfile, K8s manifests, Bicep, GHA workflow | All files written; client-side dry-runs pass |
| 5. Review | `kickstart-reviewer` | `/kickstart-review` | Validate artifacts against safeguards + security | All checks pass (or warnings accepted) |
| 6. Pre-Deploy | `kickstart-deployer` | `/kickstart-predeploy` | 6a–6g: cluster ready, ACR attach (PIM-aware), kubelogin, control-plane probe, data-plane RBAC, ACR push pre-check | All probes green, user confirms |
| 7. Deploy | `kickstart-deployer` | `/kickstart-deploy` | `az acr build`, `kubectl apply`, verify | App running on AKS |

### Phase transitions
- The parent announces same-agent transitions as one-line status (*"Discovery complete — moving to Configure."*).
- Cross-agent transitions happen automatically via the `agent` tool — no user click between phases. The user sees three collapsible subagent tool calls in the chat (`kickstart-builder`, `kickstart-reviewer`, `kickstart-deployer`).
- Phases can only be skipped if the user explicitly asks AND state has the required fields. The agent invokes `/kickstart-phase-acceleration` first.

## Skill Taxonomy

All 22 skills use `disable-model-invocation: true` — they only fire when explicitly invoked via `/skill-name` by an agent.

### Shared contract (1)

| Skill | Purpose |
|---|---|
| `kickstart-state` | Progress contract: the 7-item `manage_todo_list` plus the in-context `stateDelta` JSON exchange format used between parent and subagents |

### Phase Skills (6)
One per phase (Configure is inline in the orchestrator prompt, not a separate skill).

| Skill | Phase |
|---|---|
| `kickstart-discover` | Discover |
| `kickstart-design` | Design |
| `kickstart-generate` | Generate |
| `kickstart-review` | Review |
| `kickstart-predeploy` | Pre-Deploy Check |
| `kickstart-deploy` | Deploy |

### Domain Skills (10)
Specialized knowledge loaded on demand by the phase skills.

| Skill | Domain | Invoked during |
|---|---|---|
| `kickstart-workload-identity` | Azure Workload Identity | Design, Generate |
| `kickstart-acr-integration` | ACR attachment to AKS | Generate |
| `kickstart-kaito-gpu` | KAITO GPU model inference | Generate (if GPU) |
| `kickstart-bicep-authoring` | Bicep template patterns | Generate |
| `kickstart-security-hardening` | Azure security defaults | Review |
| `kickstart-pim-activation` | PIM role activation flow | Pre-Deploy |
| `kickstart-samples` | Pre-filled sample app profiles | Welcome |
| `kickstart-github-actions-oidc` | OIDC federated credentials | Generate |
| `kickstart-github-actions-workflow` | GHA workflow structure | Generate |
| `kickstart-github-pr-conventions` | PR conventions | Generate |

### Behavioral Skills (4)
Cross-cutting behavior rules.

| Skill | Purpose |
|---|---|
| `kickstart-phase-acceleration` | Rules for skipping phases safely |
| `kickstart-collaborator-voice` | Tone: warm, direct, jargon-light; teach-then-ask pattern |
| `kickstart-file-generation` | Batch file writes: compute all → write all → report |

### Validation Skill (1)

| Skill | Purpose |
|---|---|
| `kickstart-safeguard-checklist` | 13 deployment safeguard rules (DS001-DS013) for K8s manifest validation |

## Skill Invocation Map

Which skills get invoked at each phase:

```
Phase 1 — Discover
  └── /kickstart-discover
  └── /kickstart-collaborator-voice
  └── /kickstart-samples (if user picks "Start from an example")

Phase 2 — Configure Infrastructure
  └── az CLI commands (az group create, az aks create, az acr create)

Phase 3 — Design
  └── /kickstart-design
  └── /kickstart-workload-identity

Phase 4 — Generate
  └── /kickstart-generate
  └── /kickstart-acr-integration
  └── /kickstart-bicep-authoring
  └── /kickstart-github-actions-workflow
  └── /kickstart-github-actions-oidc
  └── /kickstart-github-pr-conventions
  └── /kickstart-workload-identity
  └── /kickstart-kaito-gpu (if GPU workload)
  └── /kickstart-file-generation

Phase 5 — Review
  └── /kickstart-review
  └── /kickstart-safeguard-checklist
  └── /kickstart-security-hardening

Phase 6 — Pre-Deploy Check
  └── /kickstart-predeploy
  └── /kickstart-pim-activation (only if ACR attach hits AuthorizationFailed)
  └── az aks show (verify cluster ready)
  └── az aks update --attach-acr

Phase 7 — Deploy
  └── /kickstart-deploy
```

## VS Code Tools Used

The agents use VS Code Copilot's built-in tools (not custom extension tools):

| Tool | Used for |
|---|---|
| `editFiles` | Write Dockerfile, K8s manifests, Bicep, GHA workflows to workspace |
| `search` | Find existing files (Dockerfile, CI configs, package manifests) |
| `codebase` | Understand app structure, detect language/framework |
| `fetch` | Retrieve Azure Retail Prices API, external docs |
| `runCommands` | Run `az`, `kubectl`, `gh` CLI commands for validation and deployment |
| `problems` | Check VS Code diagnostics panel for errors |
| `usages` | Find code references |
| `vscode_askQuestions` | Present interactive choice prompts to the user instead of waiting for free text |
| `run_in_terminal` | Run shell commands in a persistent zsh terminal session (sync or async) |
| `get_terminal_output` | Read output from a running terminal command |
| `send_to_terminal` | Send input to interactive terminal prompts |
| `kill_terminal` | Stop a running terminal session |

## File Layout

```
├── package.json                        # chatAgents + chatSkills + settings
├── tsconfig.json
├── AGENTS.md                           # agent topology + ownership reference
├── src/extension.ts                    # Activation + aks.kickstartFocus command
├── agents/
│   ├── kickstart.agent.md              # Orchestrator (Discover + Configure)
│   ├── kickstart-builder.agent.md      # Design + Generate
│   ├── kickstart-reviewer.agent.md     # Review
│   └── kickstart-deployer.agent.md     # Pre-Deploy + Deploy
├── skills/
│   ├── kickstart-state/SKILL.md         # Shared state contract
│   ├── kickstart-discover/SKILL.md      # Phase skills (6)
│   ├── kickstart-design/SKILL.md
│   ├── kickstart-generate/SKILL.md
│   ├── kickstart-review/SKILL.md
│   ├── kickstart-predeploy/SKILL.md
│   ├── kickstart-deploy/SKILL.md
│   ├── kickstart-workload-identity/SKILL.md  # Domain skills (10)
│   ├── kickstart-acr-integration/SKILL.md
│   ├── kickstart-kaito-gpu/SKILL.md
│   ├── kickstart-pim-activation/SKILL.md
│   ├── kickstart-bicep-authoring/SKILL.md
│   ├── kickstart-security-hardening/SKILL.md
│   ├── kickstart-github-actions-oidc/SKILL.md
│   ├── kickstart-github-actions-workflow/SKILL.md
│   ├── kickstart-github-pr-conventions/SKILL.md
│   ├── kickstart-samples/SKILL.md
│   ├── kickstart-safeguard-checklist/SKILL.md   # Validation
│   ├── kickstart-phase-acceleration/SKILL.md    # Behavioral (3)
│   ├── kickstart-collaborator-voice/SKILL.md
│   └── kickstart-file-generation/SKILL.md
└── prompts/
    └── kickstart.prompt.md             # Quick-start prompt file
```
