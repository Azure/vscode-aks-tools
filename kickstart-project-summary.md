# Kickstart — Project Summary

## Goal

Kickstart is an **AI-guided onboarding platform** that helps developers deploy applications to **Azure Kubernetes Service (AKS) Automatic** through a conversational interface. It abstracts away Kubernetes complexity, letting developers go from "I have an app" to "it's running on Azure" without needing Kubernetes knowledge.

## Core Architecture

Kickstart follows a **harness + packs** architecture:

- **Harness** (`@kickstart/harness`) — A domain-agnostic runtime engine that provides the Runner, session management, SSE streaming, pack registry, guardrails engine, and skill resolution. It knows nothing about Azure or Kubernetes.
- **Packs** — Domain-specific plugins that contribute all product knowledge:
  - `pack-core` — Base agents (e.g. `core.triage`), foundational tools (`core.emit_ui`, `core.write_file`), A2UI components, and content-safety guardrails
  - `pack-azure` — Azure agents, ARM tools, MSAL-based login user actions, credential guardrails
  - `pack-aks-automatic` — AKS Automatic deployment logic, container security guardrails
  - `pack-github` — GitHub OAuth, repo tools, and CI/CD agents

## Two Surfaces, One Engine

| Surface | Description | LLM |
|---------|------------|-----|
| **Web Portal** | React 19 + Vite 6 SPA with a Copilot-style chat panel, hosted on Azure Static Web Apps | Azure OpenAI |
| **IDE (MCP Server)** | Model Context Protocol server for VS Code Copilot and Claude Code | User's own LLM |

Both surfaces share the same harness runtime — identical pack registry, runner, and session logic.

## Five Primitives

Every pack contributes items from five primitive types:

| Primitive | Purpose |
|-----------|---------|
| **Agent** | LLM persona with instructions, tools, and handoff targets (e.g. `core.triage`, `azure.architect`) |
| **Tool** | Function the LLM can call (e.g. `azure.arm_get`, `core.write_file`) |
| **UserAction** | Browser-side interaction that pauses the agent run (e.g. `azure:login` triggers MSAL popup, `github:oauth` triggers OAuth flow) |
| **Component** | A2UI (Fluent UI 2) component rendered from structured JSON in chat |
| **Guardrail** | Cross-cutting check at input, tool-call, or output stages (e.g. token budget, content safety, no hardcoded creds) |

## Data Flow

```
User sends message
    │
    ▼
POST /api/converse { sessionId, message }
    │
    ├── 1. Rate limiting + input guardrails (token budget, content safety)
    │
    ├── 2. Session lookup or creation (in-memory, 1hr TTL, GC every 10min)
    │
    ├── 3. Runner selects the active Agent
    │      (session.activeAgent, defaults to core.triage)
    │
    ├── 4. Dynamic prompt assembly per turn:
    │      ┌──────────────────────────────────────┐
    │      │  Agent base instructions (.agent.md) │
    │      │  + Resolved skills (SKILL.md files    │
    │      │    matched by agent name + keywords)  │
    │      │  + A2UI component catalog snapshot    │
    │      └──────────────────────────────────────┘
    │
    ├── 5. @openai/agents SDK streams the LLM response
    │      • Text chunks → SSE "chunk" events → client renders markdown
    │      • core.emit_ui tool calls → SSE "a2ui" events → client renders components
    │      • Other tool calls → SSE "tool" events → executed server-side
    │
    ├── 6. UserAction encountered?
    │      YES → Pause run, emit SSE "user_action_required"
    │            → Browser performs action (MSAL popup, GitHub OAuth, etc.)
    │            → POST /api/converse/resume with result
    │            → Runner rebuilds history and resumes
    │
    ├── 7. Output guardrails run on final response
    │
    ├── 8. AgentOutput { message, intent } produced
    │      → SSE "done" event sent to client
    │
    └── 9. Handoff? → Next agent picks up future turns
```

### Skill Resolution (per turn)

1. Match each skill's `appliesTo` glob against the current agent name
2. Score matched skills by keywords in recent conversation turns
3. Sort by priority, cap at token budget (~2000 tokens)
4. Append skill text to the agent's dynamic instructions

### State Management

| Data | Location | Lifetime |
|------|----------|----------|
| Conversation messages | Server session (in-memory) | 1 hour |
| Active agent | Server session | Per turn |
| Generated artifacts | Server session | 1 hour |
| Virtual filesystem (files) | Client IndexedDB (`kickstart-vfs`) | Persistent |

On session expiry, the client resends message history to rehydrate a fresh session.

## Key Capabilities

- **Conversational deployment** — Multi-turn guided flow: understand app → architect Azure resources → configure AKS → deploy
- **Agent handoffs** — Triage agent routes to specialized agents (Azure architect, GitHub agent, etc.) which hand off to each other
- **A2UI component rendering** — Agents emit structured JSON that renders as rich Fluent UI 2 components in-chat (login cards, resource pickers, action buttons, code blocks)
- **UserAction pause/resume** — Agent runs pause for browser-side authentication and authorization, then resume with results
- **Guardrails** — Input validation, output checks, and tool-call interception (token budgets, content safety, no hardcoded credentials, no privileged containers)
- **MCP server** — Same logic available in VS Code and Claude Code via Model Context Protocol
- **Playground** — Interactive sandbox at `/?playground` for exploring A2UI components without a backend
- **Extensible** — Add conversation phases, tools, integration kits, API endpoints, or MCP tools via the pack system

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | TypeScript, npm workspaces monorepo |
| Frontend | React 19, Vite 6, Fluent UI 2 (A2UI) |
| API | Azure Functions (Node.js) |
| AI | Azure OpenAI via `@openai/agents` SDK |
| IDE | MCP SDK (`@modelcontextprotocol/sdk`) |
| Infrastructure | Bicep, Azure Static Web Apps |
| Testing | Vitest (unit), Playwright (e2e) |
| CI/CD | GitHub Actions |
