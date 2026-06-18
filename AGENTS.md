# Agents

This extension contributes two declarative Copilot chat agents defined in `agents/`. They have no runtime TypeScript code — behavior is entirely driven by markdown prompts and skill invocations.

## kickstart

**File**: `agents/kickstart.agent.md`
**User-invocable**: Yes (gated by `aks.kickstart.enabled` setting)
**Tools**: `edit/editFiles`, `search`, `search/codebase`, `web/fetch`, `execute/getTerminalOutput`, `execute/runInTerminal`, `read/terminalLastCommand`, `read/terminalSelection`, `read/problems`, `search/usages`, `vscode/askQuestions`, `vscode/runCommand`, `execute/killTerminal`
**Models**: Claude Sonnet 4, GPT-4o

Guides users through deploying an application to AKS Automatic in seven sequential phases:

1. **Discover** — Understand the app (language, deps, ports, env vars)
2. **Configure Infrastructure** — Launch the dedicated Kickstart cluster-setup view; it creates an AKS Automatic cluster + ACR (registry pre-attached) and reports the names back to chat.
3. **Design** — Propose target architecture, get approval
4. **Generate** — Create Dockerfile, K8s manifests, Bicep, GitHub Actions workflow
5. **Review** — First-pass per-artifact validation, then auto-hand-off to `kickstart-reviewer` for deep security + cross-artifact pass
6. **Pre-Deploy Check** — Verify cluster is ready, ACR attached, permissions in place
7. **Deploy** — Build, push, apply with `az` CLI and `kubectl`

Each phase invokes a dedicated phase skill (`/kickstart-discover`, `/kickstart-design`, etc.) plus domain-specific skills as needed.

**Handoff**: At the end of Phase 5, auto-hands off to `kickstart-reviewer` (`send: true`); reviewer returns with proceed-or-fix verdict.

## kickstart-reviewer

**File**: `agents/kickstart-reviewer.agent.md`
**User-invocable**: No (internal, reached only via auto-handoff from kickstart)
**Tools**: `search`, `search/codebase`, `read/problems`, `search/usages`, `vscode/askQuestions`, `execute/runInTerminal`, `execute/getTerminalOutput`, `read/terminalLastCommand`, `read/terminalSelection`

Deep second-pass review: security hardening (`/kickstart-security-hardening`), cross-artifact consistency (image refs / managed-identity client-ids / namespaces aligned across `k8s/`, Bicep, and GitHub Actions), and AKS Automatic compatibility spot-checks. Does **not** re-run `/kickstart-review` — that's already run by the main agent before the handoff.

Invokes: `/kickstart-security-hardening` (plus spot-checks against `/kickstart-safeguard-checklist`).

**Handoff**: Returns to `kickstart` via one of two context-aware handoffs — "proceed to Pre-Deploy" on pass, "fix issues" on any FAIL.

## Entry Points

| Method | Command/Action | Effect |
|---|---|---|
| Agent picker | Select "kickstart" in Copilot dropdown | Starts Phase 1 |
| Command palette | `AKS: Launch Kickstart Agent` (`aks.kickstartFocus`) | Hides sidebar/panel, opens chat, invokes kickstart |
| Prompt file | `kickstart.prompt.md` | Lightweight discovery flow |

## Skills

19 skills in `skills/` provide domain knowledge to the agents. All use `disable-model-invocation: true` — they fire **only** when an agent (or another skill) explicitly references them by name. WHEN-triggers are intentionally omitted from skill descriptions for this reason. Categorized as:

- **Phase skills (7)**: One per phase — step-by-step playbooks (`discover`, `configure-infra`, `design`, `generate`, `review`, `handoff`, `deploy`)
- **Operational skill (1)**: `cluster-status` — non-blocking AKS provisioning peek run at the end of Phases 3 and 4
- **Onboarding skill (1)**: `samples` — pre-filled app profiles for "Start from an example"
- **Domain skills (6)**: Workload Identity, ACR integration, Bicep authoring, security hardening, PIM activation, GitHub PR conventions
- **Behavioral skills (3)**: Phase acceleration, collaborator voice, file-generation batching
- **Validation skill (1)**: Safeguard checklist (21 manifest safeguard rules)
