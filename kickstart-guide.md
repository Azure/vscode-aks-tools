# Kickstart Extension Guide

How the Kickstart VS Code extension works — agents, skills, handoffs, and the phase machine.

## Architecture

Kickstart is a VS Code Copilot extension that uses **declarative agents and skills** (no runtime code). Everything is contributed via `package.json` using the `chatAgents` and `chatSkills` contribution points from the `chatParticipantAdditions` proposed API.

```
User selects "kickstart" agent in Copilot
        │
        ▼
┌─────────────────────────────────────────┐
│         kickstart.agent.md              │
│  (main orchestrator, user-invocable)    │
│                                         │
│  Phase Machine:                         │
│  Discover → Design → Generate →         │
│  Review → Handoff → Deploy              │
│                                         │
│  At each phase, invokes /kickstart-*    │
│  skills for playbooks + domain rules    │
├─────────────────────────────────────────┤
│  Handoff: "Review Artifacts"            │
│  ──────► kickstart-reviewer.agent.md    │
│          (internal, not user-invocable) │
│          Handoff: "Back to Kickstart"   │
│  ◄────── returns to main agent         │
└─────────────────────────────────────────┘
```

## Feature Gate

The main agent is gated by a VS Code setting:

```json
"aks.kickstart.enabled": true  // default
```

The `chatAgents` entry uses `"when": "config.aks.kickstart.enabled == true"` so the agent only appears in the Copilot agent picker when the setting is enabled. The reviewer sub-agent has no `when` clause — it's internal and only reachable via handoff.

## Entry Points

| Entry Point | How | What happens |
|---|---|---|
| **Agent picker** | User selects "kickstart" in Copilot's agent dropdown | Full agent prompt loads, starts at Phase 1 |
| **Command palette** | User runs `AKS: Launch Kickstart Agent` (`aks.kickstartFocus`) | Hides sidebar/panel, opens chat, sends initial message to kickstart agent |
| **Prompt file** | User runs `kickstart.prompt.md` from the prompt picker | Lightweight version — invokes `/kickstart-discover` and starts the flow |

## Agent Handoffs

There are exactly two agents and one handoff cycle:

### kickstart → kickstart-reviewer

- **When**: Phase 4 (Review). After artifacts are generated, the main agent offers "Review Artifacts" as a suggested action.
- **Mechanism**: `handoffs` in frontmatter with `send: false` (user clicks to confirm).
- **What reviewer does**: Invokes `/kickstart-deployment-review`, `/kickstart-safeguard-checklist`, `/kickstart-security-hardening`. Checks every generated file against a pass/fail/warn checklist.

### kickstart-reviewer → kickstart

- **When**: Review is complete. The reviewer offers "Back to Kickstart" as a suggested action.
- **Mechanism**: Same `handoffs` pattern with `send: false`.
- **What happens next**: Main agent resumes at Phase 5 (Handoff).

Both handoffs are **user-initiated** — Copilot presents them as buttons, not automatic transfers.

## Phase Machine

The main agent follows seven phases in strict order. Each phase has a dedicated **phase skill** that contains the playbook.

| Phase | Skill | What it does | Exit criteria |
|---|---|---|---|
| 1. Discover | `/kickstart-discover` | Collect app name, language, framework, deps, port, env vars, Dockerfile/CI status | Enough info to propose architecture |
| 2. Configure | (inline in agent) | Create new or select existing Azure resources (RG, AKS cluster, ACR). Cluster creates with `--no-wait` | Resources selected/creating |
| 3. Design | `/kickstart-design` | Propose AKS Automatic architecture, get user approval | User approves |
| 4. Generate | `/kickstart-generate` | Create Dockerfile, K8s manifests, Bicep, GHA workflow | All files written to workspace |
| 5. Review | `/kickstart-review` | Validate artifacts against safeguards + security | All checks pass |
| 6. Pre-Deploy | `/kickstart-handoff` | Verify cluster ready, ACR attached, final summary | Cluster provisioned, user confirms |
| 7. Deploy | `/kickstart-deploy` | Build, push, apply with `az` and `kubectl` | App running on AKS |

### Phase transitions
- The agent announces each transition: *"Discovery complete — moving to the Design phase."*
- Phases can only be skipped if the user explicitly asks AND all info is available. If skipping, the agent invokes `/kickstart-phase-acceleration` first.

## Skill Taxonomy

All 30 skills use `disable-model-invocation: true` — they only fire when explicitly invoked via `/skill-name` by an agent.

### Phase Skills (6)
One per phase (Configure is inline in the agent prompt, not a separate skill).

| Skill | Phase |
|---|---|
| `kickstart-discover` | Discover |
| `kickstart-design` | Design |
| `kickstart-generate` | Generate |
| `kickstart-review` | Review |
| `kickstart-handoff` | Pre-Deploy Check |
| `kickstart-deploy` | Deploy |

### Domain Skills (19)
Specialized knowledge loaded on demand by the phase skills.

| Skill | Domain | Invoked during |
|---|---|---|
| `kickstart-aks-automatic` | AKS Automatic cluster creation | Design |
| `kickstart-gateway-api` | Gateway API + HTTPRoute | Design, Generate |
| `kickstart-workload-identity` | Azure Workload Identity | Design, Generate |
| `kickstart-acr-integration` | ACR attachment to AKS | Generate |
| `kickstart-kaito-gpu` | KAITO GPU model inference | Generate (if GPU) |
| `kickstart-aks-terminology` | AKS naming conventions | Design |
| `kickstart-deployment-safeguards` | K8s security constraints | Generate |
| `kickstart-bicep-authoring` | Bicep template patterns | Generate |
| `kickstart-security-hardening` | Azure security defaults | Review |
| `kickstart-deployment-review` | Artifact review checklist | Review |
| `kickstart-resource-management` | Azure resource naming | Configure |
| `kickstart-networking` | Azure networking concepts | Design |
| `kickstart-cost-estimation` | Cost estimation via Retail Prices API | Design, Deploy |
| `kickstart-monitoring` | Azure Monitor + Container Insights | Deploy |
| `kickstart-arm-basics` | ARM resource model | Generate |
| `kickstart-azure-identity` | Managed identity concepts | Design |
| `kickstart-github-actions-oidc` | OIDC federated credentials | Generate |
| `kickstart-github-actions-workflow` | GHA workflow structure | Generate |
| `kickstart-github-pr-conventions` | PR conventions | Generate |

### Behavioral Skills (4)
Cross-cutting behavior rules.

| Skill | Purpose |
|---|---|
| `kickstart-phase-acceleration` | Rules for skipping phases safely |
| `kickstart-teach-then-ask` | Explain context before asking questions |
| `kickstart-collaborator-voice` | Tone: warm, direct, jargon-light |
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
  └── /kickstart-teach-then-ask

Phase 2 — Configure Infrastructure
  └── /kickstart-resource-management
  └── /kickstart-cost-estimation (if user asks)
  └── az CLI commands (az group create, az aks create, az acr create)

Phase 3 — Design
  └── /kickstart-design
  └── /kickstart-aks-automatic
  └── /kickstart-gateway-api
  └── /kickstart-workload-identity
  └── /kickstart-aks-terminology
  └── /kickstart-cost-estimation (if user asks)

Phase 4 — Generate
  └── /kickstart-generate
  └── /kickstart-deployment-safeguards
  └── /kickstart-acr-integration
  └── /kickstart-bicep-authoring
  └── /kickstart-github-actions-workflow
  └── /kickstart-github-actions-oidc
  └── /kickstart-kaito-gpu (if GPU workload)
  └── /kickstart-file-generation

Phase 5 — Review
  └── /kickstart-review
  └── /kickstart-safeguard-checklist
  └── /kickstart-deployment-review
  └── /kickstart-security-hardening
  └── HANDOFF → kickstart-reviewer agent

Phase 6 — Pre-Deploy Check
  └── /kickstart-handoff
  └── az aks show (verify cluster ready)
  └── az aks update --attach-acr

Phase 7 — Deploy
  └── /kickstart-deploy
  └── /kickstart-cost-estimation
  └── /kickstart-monitoring
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
├── src/extension.ts                    # Activation + aks.kickstartFocus command
├── agents/
│   ├── kickstart.agent.md              # Main agent (gated by kickstart.enabled)
│   └── kickstart-reviewer.agent.md     # Internal reviewer sub-agent
├── skills/
│   ├── kickstart-discover/SKILL.md     # Phase skills (6)
│   ├── kickstart-design/SKILL.md
│   ├── kickstart-generate/SKILL.md
│   ├── kickstart-review/SKILL.md
│   ├── kickstart-handoff/SKILL.md
│   ├── kickstart-deploy/SKILL.md
│   ├── kickstart-aks-automatic/SKILL.md  # Domain skills (19)
│   ├── kickstart-gateway-api/SKILL.md
│   ├── kickstart-workload-identity/SKILL.md
│   ├── kickstart-acr-integration/SKILL.md
│   ├── kickstart-kaito-gpu/SKILL.md
│   ├── kickstart-aks-terminology/SKILL.md
│   ├── kickstart-deployment-safeguards/SKILL.md
│   ├── kickstart-bicep-authoring/SKILL.md
│   ├── kickstart-security-hardening/SKILL.md
│   ├── kickstart-deployment-review/SKILL.md
│   ├── kickstart-resource-management/SKILL.md
│   ├── kickstart-networking/SKILL.md
│   ├── kickstart-cost-estimation/SKILL.md
│   ├── kickstart-monitoring/SKILL.md
│   ├── kickstart-arm-basics/SKILL.md
│   ├── kickstart-azure-identity/SKILL.md
│   ├── kickstart-github-actions-oidc/SKILL.md
│   ├── kickstart-github-actions-workflow/SKILL.md
│   ├── kickstart-github-pr-conventions/SKILL.md
│   ├── kickstart-phase-acceleration/SKILL.md   # Behavioral skills (4)
│   ├── kickstart-teach-then-ask/SKILL.md
│   ├── kickstart-collaborator-voice/SKILL.md
│   ├── kickstart-file-generation/SKILL.md
│   └── kickstart-safeguard-checklist/SKILL.md  # Validation (1)
└── prompts/
    └── kickstart.prompt.md             # Quick-start prompt file
```
