# Kickstart Extension Guide

How the Kickstart VS Code extension works — agents, skills, handoffs, and the phase machine.

## Architecture

Kickstart is a VS Code Copilot extension that uses **declarative agents and skills** (no runtime code). Everything is contributed via `package.json` using the `chatAgents` and `chatSkills` contribution points from the `chatParticipantAdditions` proposed API.

The flow is split across **four sub-agents** that hand off to each other. State is persisted to `.kickstart/state.json` so handoffs (and session restarts) don't depend on chat scrollback.

```
User selects "kickstart" agent in Copilot
        │
        ▼
  kickstart (Welcome → Discover → Configure)
        │  Design & Generate Artifacts
        ▼
  kickstart-builder (Design → Generate)
        │  Review Artifacts
        ▼
  kickstart-reviewer (Review)
        │  Proceed to Deploy   /   Fix and Regenerate → builder
        ▼
  kickstart-deployer (Pre-Deploy → Deploy)
        │  (on auth/config issue) Back to Kickstart
        ▼
  kickstart  (re-enter Discover or Configure, then hand off forward)
```

All four agents read `.kickstart/state.json` on entry and write it on exit. The schema and read/write helpers live in [skills/kickstart-state/SKILL.md](skills/kickstart-state/SKILL.md).

## Feature Gate

All agents are gated by a VS Code setting:

```json
"aks.kickstart.enabled": true  // default
```

The four `chatAgents` entries use `"when": "config.aks.kickstart.enabled == true"`. Only `kickstart` appears in the Copilot agent picker — the three sub-agents have `user-invocable: false` in their frontmatter and are only reachable via handoff.

## Entry Points

| Entry Point | How | What happens |
|---|---|---|
| **Agent picker** | User selects "kickstart" in Copilot's agent dropdown | Full orchestrator prompt loads, starts at Welcome → Phase 1 |
| **Command palette** | User runs `AKS: Launch Kickstart Agent` (`aks.kickstartFocus`) | Hides sidebar/panel, opens chat, sends initial message to kickstart agent |
| **Prompt file** | User runs `kickstart.prompt.md` from the prompt picker | Lightweight version — invokes `/kickstart-discover` and starts the flow |

## Agent Handoffs

Four agents with five forward handoffs and three back-edges. All handoffs use `send: false` so the user clicks to confirm — each one is a deliberate checkpoint.

### Forward edges

| From | To | Trigger |
|---|---|---|
| `kickstart` | `kickstart-builder` | End of Configure (Phase 2); state has `app.*` + `azure.*` populated |
| `kickstart-builder` | `kickstart-reviewer` | End of Generate (Phase 4); state has `artifacts.*` populated |
| `kickstart-reviewer` | `kickstart-deployer` | Review passed (or only warnings accepted) |
| `kickstart-reviewer` | `kickstart-builder` | Review failed; needs regenerate |
| `kickstart-deployer` | `kickstart-reviewer` | Deploy-time issue traced back to artifact (e.g. ImagePullBackOff) |

### Back-edges to `kickstart` (escalation)

Any sub-agent can hand back to `kickstart` when an issue is rooted in discovery or infrastructure decisions. The orchestrator reads state, re-runs the appropriate phase, and hands off forward again.

## State Contract

Every agent persists decisions to `.kickstart/state.json`. Defined in `/kickstart-state`. Sections and owners:

| Section | Owner |
|---|---|
| `app.*` | `kickstart` (Discover) |
| `azure.*` | `kickstart` (Configure) |
| `cluster.*` | `kickstart` (peek), `kickstart-deployer` (full probes) |
| `artifacts.*` | `kickstart-builder` |
| `review.*` | `kickstart-reviewer` |
| `deploy.*` | `kickstart-deployer` |
| `phase`, `lastAgent`, `updatedAt` | every agent on transition |

State lets agents resume after session restart, lets handoffs work without re-deriving context from chat scrollback, and lets the orchestrator render a one-line status pill on re-entry: `[Phase: deploy · Cluster: Succeeded · ACR: attached · Artifacts: 7]`.

## Phase Machine

Seven phases in strict order, owned by four agents. Each phase has a dedicated **phase skill** with the playbook.

| Phase | Owner agent | Skill | What it does | Exit criteria |
|---|---|---|---|---|
| 1. Discover | `kickstart` | `/kickstart-discover` | Collect app name, language, framework, deps, port, env vars, Dockerfile/CI status | Enough info to propose architecture |
| 2. Configure | `kickstart` | (inline in agent) | Create or select Azure resources (RG, AKS cluster, ACR). Cluster creates with `--no-wait` | Resources selected/creating |
| 3. Design | `kickstart-builder` | `/kickstart-design` | Propose AKS Automatic architecture, get user approval | User approves |
| 4. Generate | `kickstart-builder` | `/kickstart-generate` | Create Dockerfile, K8s manifests, Bicep, GHA workflow | All files written; client-side dry-runs pass |
| 5. Review | `kickstart-reviewer` | `/kickstart-review` | Validate artifacts against safeguards + security | All checks pass (or warnings accepted) |
| 6. Pre-Deploy | `kickstart-deployer` | `/kickstart-handoff` | 6a–6g: cluster ready, ACR attach (PIM-aware), kubelogin, control-plane probe, data-plane RBAC, ACR push pre-check | All probes green, user confirms |
| 7. Deploy | `kickstart-deployer` | `/kickstart-deploy` | `az acr build`, `kubectl apply`, verify | App running on AKS |

### Phase transitions
- Each agent announces transitions: *"Discovery complete — moving to Configure."*
- Cross-agent transitions surface as **handoff buttons** the user clicks (`send: false`).
- Phases can only be skipped if the user explicitly asks AND state has the required fields. The agent invokes `/kickstart-phase-acceleration` first.

## Skill Taxonomy

All 31 skills use `disable-model-invocation: true` — they only fire when explicitly invoked via `/skill-name` by an agent.

### Shared contract (1)

| Skill | Purpose |
|---|---|
| `kickstart-state` | `.kickstart/state.json` schema and read/write helpers, referenced by all four agents on entry/exit |

### Phase Skills (6)
One per phase (Configure is inline in the orchestrator prompt, not a separate skill).

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
│   ├── kickstart-handoff/SKILL.md
│   ├── kickstart-deploy/SKILL.md
│   ├── kickstart-aks-automatic/SKILL.md  # Domain skills
│   ├── kickstart-gateway-api/SKILL.md
│   ├── kickstart-workload-identity/SKILL.md
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
│   ├── kickstart-phase-acceleration/SKILL.md    # Behavioral
│   ├── kickstart-collaborator-voice/SKILL.md
│   └── kickstart-file-generation/SKILL.md
└── prompts/
    └── kickstart.prompt.md             # Quick-start prompt file
```
