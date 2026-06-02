# Agents

This extension contributes two declarative Copilot chat agents defined in `agents/`. They have no runtime TypeScript code — behavior is entirely driven by markdown prompts and skill invocations.

## kickstart

**File**: `agents/kickstart.agent.md`
**User-invocable**: Yes (gated by `aks.kickstart.enabled` setting)
**Tools**: editFiles, search, codebase, fetch, runCommands, problems, usages, vscode_askQuestions, run_in_terminal, get_terminal_output, send_to_terminal, kill_terminal
**Models**: Claude Sonnet 4, GPT-4o

Guides users through deploying an application to AKS Automatic in seven sequential phases:

1. **Discover** — Understand the app (language, deps, ports, env vars)
2. **Configure Infrastructure** — Create new or select existing Azure resources (RG, AKS, ACR). Cluster creates with `--no-wait` to run in background.
3. **Design** — Propose target architecture, get approval
4. **Generate** — Create Dockerfile, K8s manifests, Bicep, GitHub Actions workflow
5. **Review** — Validate artifacts against safeguards and security checks
6. **Pre-Deploy Check** — Verify cluster is ready, ACR attached
7. **Deploy** — Build, push, apply with `az` CLI and `kubectl`

Each phase invokes a dedicated phase skill (`/kickstart-discover`, `/kickstart-design`, etc.) plus domain-specific skills as needed. See `kickstart-guide.md` for the full skill invocation map.

**Handoff**: At Phase 4, hands off to `kickstart-reviewer` for artifact validation.

## kickstart-reviewer

**File**: `agents/kickstart-reviewer.agent.md`
**User-invocable**: No (internal, reached only via handoff from kickstart)
**Tools**: search, codebase, problems, usages, vscode_askQuestions, run_in_terminal, get_terminal_output

Reviews all generated deployment artifacts (Dockerfile, K8s manifests, Bicep, GitHub Actions) against a pass/fail/warn checklist covering security, correctness, and AKS Automatic compliance.

Invokes: `/kickstart-deployment-review`, `/kickstart-safeguard-checklist`, `/kickstart-security-hardening`

**Handoff**: Returns to `kickstart` agent when review is complete.

## Entry Points

| Method | Command/Action | Effect |
|---|---|---|
| Agent picker | Select "kickstart" in Copilot dropdown | Starts Phase 1 |
| Command palette | `AKS: Launch Kickstart Agent` (`aks.kickstartFocus`) | Hides sidebar/panel, opens chat, invokes kickstart |
| Prompt file | `kickstart.prompt.md` | Lightweight discovery flow |

## Skills

30 skills in `skills/` provide domain knowledge to the agents. All use `disable-model-invocation: true` (only fire when explicitly invoked). Categorized as:

- **Phase skills (6)**: One per phase — step-by-step playbooks
- **Domain skills (19)**: AKS Automatic, Gateway API, Workload Identity, Bicep, networking, cost estimation, etc.
- **Behavioral skills (4)**: Phase acceleration, teach-then-ask, collaborator voice, file generation batching
- **Validation skill (1)**: Safeguard checklist (DS001–DS013)
