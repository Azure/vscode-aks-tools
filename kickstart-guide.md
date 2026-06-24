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

- **When**: Phase 5 (Review). After artifacts are generated, the main agent offers "Review Artifacts" as a suggested action.
- **Mechanism**: `handoffs` in frontmatter with `send: false` (user clicks to confirm).
- **What reviewer does**: Invokes `/kickstart-review`, `/kickstart-safeguard-checklist`, `/kickstart-security-hardening`. Checks every generated file against a pass/fail/warn checklist.

### kickstart-reviewer → kickstart

- **When**: Review is complete. The reviewer offers "Back to Kickstart" as a suggested action.
- **Mechanism**: Same `handoffs` pattern with `send: false`.
- **What happens next**: Main agent resumes at Phase 5 (Handoff).

Both handoffs are **user-initiated** — Copilot presents them as buttons, not automatic transfers.

## Phase Machine

The main agent follows seven phases in strict order. Each phase has a dedicated **phase skill** that contains the playbook.

| Phase | Skill | What it does | Exit criteria |
|---|---|---|---|
| 1. Discover | `/kickstart-discover` | Collect app name, language, framework, deps, port, env vars, Dockerfile/CI status; map each service's build context, entry point, and existing Dockerfile path | Enough info to propose architecture + structure mapped |
| 2. Configure | `/kickstart-configure-infra` | Create new or select existing Azure resources (RG, AKS cluster, ACR). Cluster creates with `--no-wait` | Resources selected/creating |
| 3. Design | `/kickstart-design` | Propose AKS Automatic architecture, get user approval | User approves |
| 4. Generate | `/kickstart-generate` | Create Dockerfile (reuse existing, validate COPY/ADD paths, build & inspect image), K8s manifests, Bicep, GHA workflow | All files written + image builds |
| 5. Review | `/kickstart-review` | Confirm Dockerfile source→destination map, verify image builds, validate artifacts against safeguards + security | All checks pass |
| 6. Pre-Deploy | `/kickstart-handoff` | Verify cluster ready, ACR attached, final summary | Cluster provisioned, user confirms |
| 7. Deploy | `/kickstart-deploy` | Build (per-service context + Dockerfile path), push, apply with `az` and `kubectl`, health-check endpoint | App running + endpoint verified |

### Phase transitions
- The agent announces each transition: *"Discovery complete — moving to the Design phase."*
- Phases can only be skipped if the user explicitly asks AND all info is available. If skipping, the agent invokes `/kickstart-phase-acceleration` first.

## Skill Taxonomy

All 19 skills use `disable-model-invocation: true` — they only fire when explicitly invoked via `/skill-name` by an agent.

### Phase Skills (7)
One per phase.

| Skill | Phase |
|---|---|
| `kickstart-discover` | Discover |
| `kickstart-configure-infra` | Configure Infrastructure |
| `kickstart-design` | Design |
| `kickstart-generate` | Generate |
| `kickstart-review` | Review |
| `kickstart-handoff` | Pre-Deploy Check |
| `kickstart-deploy` | Deploy |

### Operational Skill (1)

| Skill | Purpose |
|---|---|
| `kickstart-cluster-status` | Non-blocking AKS provisioning peek; run at the end of Phases 3–5 |

### Onboarding Skill (1)

| Skill | Purpose |
|---|---|
| `kickstart-samples` | Pre-filled sample app profiles for "Start from an example" (skips Discover) |

### Domain Skills (6)
Specialized knowledge loaded on demand by the phase skills.

| Skill | Domain | Invoked during |
|---|---|---|
| `kickstart-workload-identity` | Azure Workload Identity (federated credentials, SA wiring, pod labels) | Generate |
| `kickstart-acr-integration` | ACR attachment to AKS (no pull secrets) | Generate |
| `kickstart-bicep-authoring` | Bicep template structure and conventions | Generate |
| `kickstart-security-hardening` | Azure security defaults and checks | Review |
| `kickstart-pim-activation` | Activating PIM-eligible roles for RBAC self-assignment | Configure, Pre-Deploy |
| `kickstart-github-pr-conventions` | Branch naming, Conventional Commits, PR structure | Deploy |

### Behavioral Skills (3)
Cross-cutting behavior rules.

| Skill | Purpose |
|---|---|
| `kickstart-phase-acceleration` | Rules for condensing or skipping phases safely |
| `kickstart-collaborator-voice` | Tone (warm, direct, jargon-light) + progress narration before/after questions and phase transitions |
| `kickstart-file-generation` | Batch file writes: compute all → write all → report |

### Validation Skill (1)

| Skill | Purpose |
|---|---|
| `kickstart-safeguard-checklist` | 16 manifest safeguard rules for K8s validation |

## Skill Invocation Map

Which skills get invoked at each phase:

```
Cross-cutting (every phase)
  └── /kickstart-collaborator-voice    (tone + progress narration)
  └── /kickstart-phase-acceleration    (only when condensing/skipping phases)

Onboarding — "Start from an example"
  └── /kickstart-samples               (pre-filled profile → skips Phase 1)

Phase 1 — Discover
  └── /kickstart-discover

Phase 2 — Configure Infrastructure
  └── /kickstart-configure-infra       (subscription picker, RG/ACR/cluster creation)
  └── /kickstart-pim-activation        (if RBAC self-assign returns 403)

Phase 3 — Design
  └── /kickstart-design
  └── /kickstart-cluster-status        (end-of-phase peek)

Phase 4 — Generate
  └── /kickstart-generate
        ├── /kickstart-file-generation     (batch-write order)
        ├── /kickstart-bicep-authoring
        ├── /kickstart-workload-identity
        └── /kickstart-acr-integration
  └── /kickstart-cluster-status        (end-of-phase peek)

Phase 5 — Review
  └── /kickstart-review
        └── /kickstart-safeguard-checklist
  └── /kickstart-cluster-status        (end-of-phase peek)
  └── HANDOFF → kickstart-reviewer agent
        ├── /kickstart-review
        ├── /kickstart-safeguard-checklist
        └── /kickstart-security-hardening

Phase 6 — Pre-Deploy Check
  └── /kickstart-handoff
  └── az aks show (verify cluster ready)
  └── az aks update --attach-acr
  └── /kickstart-pim-activation        (if ACR attach / RBAC needs elevation)

Phase 7 — Deploy
  └── /kickstart-deploy
  └── /kickstart-github-pr-conventions (if user commits / opens a PR)
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
│   ├── kickstart-discover/SKILL.md     # Phase skills (7)
│   ├── kickstart-configure-infra/SKILL.md
│   ├── kickstart-design/SKILL.md
│   ├── kickstart-generate/SKILL.md
│   ├── kickstart-review/SKILL.md
│   ├── kickstart-handoff/SKILL.md
│   ├── kickstart-deploy/SKILL.md
│   ├── kickstart-cluster-status/SKILL.md   # Operational (1)
│   ├── kickstart-samples/SKILL.md      # Onboarding (1)
│   ├── kickstart-workload-identity/SKILL.md  # Domain skills (6)
│   ├── kickstart-acr-integration/SKILL.md
│   ├── kickstart-bicep-authoring/SKILL.md
│   ├── kickstart-security-hardening/SKILL.md
│   ├── kickstart-pim-activation/SKILL.md
│   ├── kickstart-github-pr-conventions/SKILL.md
│   ├── kickstart-phase-acceleration/SKILL.md   # Behavioral skills (3)
│   ├── kickstart-collaborator-voice/SKILL.md
│   ├── kickstart-file-generation/SKILL.md
│   └── kickstart-safeguard-checklist/SKILL.md  # Validation (1)
└── prompts/
    └── kickstart.prompt.md             # Quick-start prompt file
```
