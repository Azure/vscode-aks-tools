# Kickstart User Journey — Reference from Web App

> **This document is a reference specification from the original Kickstart web application** (the standalone browser-based experience). It describes the user journey, UI components, and agent flow from that web app. We are porting this experience into the VS Code AKS extension as a chat participant (`@kickstart`) + webview dashboard. Not everything maps 1:1 — VS Code has different UI primitives (chat buttons, QuickPicks, stream.markdown, webview panels) — but this document is the canonical source for what the user journey *should* feel like.

---

End-to-end reference for every stage of the Kickstart onboarding flow — what the user sees, what they can do, and how the system advances them toward a deployed app on Azure.

---

## Overview

Kickstart is a guided, AI-driven conversation that takes a user from **"I have an app idea"** to **"it's running on Azure"**. The experience is split into a **Landing Page** (entry point) and a **six-phase conversation** rendered inside a chat UI with a visual phase stepper.

```
Landing Page
  │
  ├─ Free-form prompt ──────────────┐
  ├─ Track card (Web App / AI Agent)│
  ├─ Framework pill ────────────────┤
  └─ "Inspire me" ─────────────────┘
                                    ▼
            ┌─────────────────────────────────────────┐
            │  Chat UI  (phase stepper at the top)    │
            │                                         │
            │  Discover → Design → Generate →         │
            │  Review   → Handoff → Deploy            │
            └─────────────────────────────────────────┘
```

---

## Landing Page

**Component:** `packages/web/src/components/Landing.tsx`

The landing page is the first screen. No conversation exists yet. The user picks how to begin.

### Entry options

| UI Element | Behavior |
|---|---|
| **Hero textarea** | Free-form input — "Describe your app idea". Submitting calls `onStartChat(prompt)` and transitions into the chat UI. |
| **"Inspire me" button** | Streams a random app idea from `/api/inspirations` into the textarea character-by-character. The user can edit before submitting. |
| **Track cards** (2) | Large clickable cards that send a pre-written prompt and immediately enter chat. |
| **Framework pills** (10) | Small clickable badges that send a framework-specific prompt. |
| **IDE launch cards** | Deep links to open the MCP server in VS Code / VS Code Insiders. |
| **Recent sessions** | List of previous conversations with Resume / Delete actions and a "Clear all" dialog. |

### Tracks

| Track ID | Title | Prompt sent |
|---|---|---|
| `web-app` | Web App or API | *"I want to build a web application"* |
| `agentic-app` | AI Agent | *"I want to build an AI agent"* |

### Framework pills

| ID | Label |
|---|---|
| `nextjs` | Next.js |
| `fastapi` | Python FastAPI |
| `express` | Express.js |
| `dotnet` | .NET |
| `go` | Go |
| `spring` | Spring Boot |
| `django` | Django |
| `rust` | Rust |
| `langchain` | LangChain Agent |
| `rag` | RAG App |

### Inspirations (random examples cycled by the "Inspire me" button)

- Movie night pick that settles disputes
- AI recipe finder from fridge photos
- Team standup bot that respects time zones
- Pet adoption matcher powered by AI
- Real-time air quality dashboard
- Neighborhood tool lending library
- Personal finance coach that speaks plain English
- Workout generator for hotel rooms
- Live event parking optimizer
- Study group matchmaker for college

---

## Conversation Phases

Once the user enters chat, the UI displays a **phase stepper bar** (`ChatShell.tsx`) showing six phases. The agent drives advancement; the server emits SSE `phase` events to update the client.

**Phase order:** `discover` → `design` → `generate` → `review` → `handoff` → `deploy`

**Phase aliases** (the LLM can use alternate names; they map automatically):

| Alias | Canonical phase |
|---|---|
| `plan` | `design` |
| `build` | `generate` |
| `validate` | `review` |

---

### Phase 1 — Discover

**Purpose:** Understand what the user wants to build — app type, language/framework, existing code, and requirements.

**What the agent does:**
- Asks clarifying questions about the project
- Triages intent (web app vs. AI agent, greenfield vs. existing code)
- Gathers technical preferences (language, framework, database, auth)

**UI elements surfaced:**

| Component | What it does |
|---|---|
| **Questionnaire** | Multi-field form with `text`, `choice`, and `multiChoice` question types. Each question has an `id`, `label`, optional `choices` array, and `required` flag. A submit button fires an `onSubmit` action. |
| **DecisionCard** | Displays a recommendation with a `title`, `recommendation` text, optional `rationale`, `alternatives` list, and a badge (`recommended`, `best-practice`, `required`, `optional`). |
| **Text / Markdown** | Conversational responses and explanations. |

---

### Phase 2 — Design

**Purpose:** Propose an architecture and Azure resource topology based on what was discovered.

**What the agent does:**
- Recommends Azure services (AKS, Container Registry, storage, etc.)
- Proposes networking, scaling, and security configuration
- Estimates monthly cost

**UI elements surfaced:**

| Component | What it does |
|---|---|
| **SummaryCard** | Key-value summary with optional title. Each item has a `label`, `value`, and optional `badge` (`neutral`, `success`, `warning`, `danger`, `info`). |
| **DecisionCard** | Architecture decisions (e.g., "Use AKS Automatic" with rationale and alternatives). |
| **CostEstimate** | Interactive cost breakdown. Shows individual resource rows (`name`, `sku`, `monthlyEstimate`, optional `skuOptions` for user to pick, `pricingTiers`). Supports pricing models: `monthly`, `usage`, `included`. Supports live pricing lookup. The **"Approve" button is gated** — it only appears in the `review` or `deploy` phases. During `design` the estimate is informational only. |
| **ProgressSteps** | Horizontal step tracker showing the design sub-stages (`pending`, `active`, `complete`, `error`). |

---

### Phase 3 — Generate

**Purpose:** Produce the project files — Dockerfiles, Bicep/Terraform infrastructure, CI/CD pipelines, and application code.

**What the agent does:**
- Generates files step-by-step using the codex model (stepwise generation)
- Streams progress as each file is produced
- Writes files to a virtual filesystem

**UI elements surfaced:**

| Component | What it does |
|---|---|
| **GenerationProgress** | Multi-step progress tracker. Each step has an `id`, `label`, `status` (`pending`, `running`, `complete`, `error`, `skipped`), and optional `detail`/`timestamp`. Shows `overallStatus` (`idle`, `running`, `complete`, `error`) and optional links (`appUrl`, `portalUrl`). Supports polling via `pollIntervalMs` for deploy-time status. |
| **FileEditor** | Inline Monaco-backed code editor showing a generated file. Users can view and edit the content before it's committed. |
| **CodeBlock** | Syntax-highlighted read-only code display. |
| **ProgressSteps** | Sub-step tracker for the generation pipeline. |

---

### Phase 4 — Review

**Purpose:** Validate generated artifacts and let the user approve or request changes.

**What the agent does:**
- Runs validation checks on generated files (linting, schema validation, completeness)
- Presents the full artifact set for user review
- Asks for approval to proceed

**UI elements surfaced:**

| Component | What it does |
|---|---|
| **CostEstimate** | Same component as Design, but now the **"Approve" CTA is active** — the user can approve the cost gate, which unblocks deployment. Calls `approveCostGate()` on the backend. |
| **SummaryCard** | Recap of what will be deployed (resources, config, files). |
| **FileEditor** | Users can make final edits to any generated file. |
| **DecisionCard** | Any remaining choices (e.g., "Use managed identity vs. service principal"). |
| **Questionnaire** | Follow-up questions if the agent needs more input before proceeding. |

---

### Phase 5 — Handoff

**Purpose:** Connect to Azure and GitHub — authenticate, select target subscription/org/repo.

**What the agent does:**
- Prompts the user to sign into Azure (MSAL) and GitHub (OAuth)
- Asks the user to select a subscription, resource group, and/or region
- Asks the user to select or create a GitHub repository

**UI elements surfaced:**

| Component | What it does |
|---|---|
| **AzureLoginCard** | Azure sign-in card. Shows an MSAL-powered login button; after auth it displays the signed-in user (avatar, name, email), subscription count, and a sign-out option. Props: `displayName`, `showTokenInfo`, `onSignIn`/`onSignOut` actions. |
| **GitHubLoginCard** | GitHub OAuth login card. Similar flow — login button, then shows authenticated user info. |
| **AzureResourcePicker** | Subscription + resource group + location selector. Pre-filters by `subscriptionId`, `resourceGroup`, `resourceType`, `location`. Shows existing resources or lets the user create new ones. Fires an `onSelect` action with the chosen target. Also supports triggering deployment directly (`startAzureDeployment`). |
| **GitHubRepoPicker** | Repository selector. Lists repos by org/owner with search. Supports creating a new repo (name, description, visibility). Fires `onSelect` with the chosen repo. Props: `placeholder`, `owner`, `allowCreate`, `onSelect`/`onCreate` actions. |
| **AuthCard** | Generic authentication card for other auth flows. |

**UserActions triggered** (pause the agent, require browser interaction):

| Action | What happens in the browser |
|---|---|
| `azure:select_subscription` | Subscription picker UI |
| `github:login` | GitHub OAuth popup |
| `github:pick_org` | GitHub organization selector |
| `github:pick_repo` | Repository picker |
| `github:create_repo` | New repository creation form |

---

### Phase 6 — Deploy

**Purpose:** Provision Azure resources and push code to production.

**What the agent does:**
- Creates/validates Azure resources (AKS cluster, ACR, networking, etc.)
- Pushes code to the selected GitHub repo
- Creates a pull request with the generated files
- Sets GitHub Actions secrets for CI/CD
- Monitors deployment progress

**UI elements surfaced:**

| Component | What it does |
|---|---|
| **GenerationProgress** | Reused from Generate phase, now tracking deployment steps. Shows `overallStatus`, individual step progress, and on completion displays `appUrl` (live app link) and `portalUrl` (Azure Portal link). Polls the backend via `runId` + `pollIntervalMs` for real-time status. |
| **AzureAction** | Azure deployment action/progress display. |
| **GitHubAction** | GitHub action display (PR creation, secret configuration). |
| **GitHubCommit** | Displays commit details after code is pushed. |
| **ProgressSteps** | Deployment sub-step tracker. |
| **CostEstimate** | Final cost confirmation (if not already approved in Review). |

**UserActions triggered:**

| Action | What happens in the browser |
|---|---|
| `azure:deploy` | High-level deploy confirmation flow |
| `azure:deploy_resource` | Individual resource provisioning |
| `azure:delete_resource` | Resource deletion confirmation |
| `azure:update_resource` | Resource update |
| `aks:deploy` | AKS-specific deployment flow |
| `github:create_pr` | Pull request creation |
| `github:set_secret` | Repository secret configuration |

---

## UserActions — Pause/Resume Interactions

UserActions are **not** regular LLM tools. They interrupt the agent run, emit a `user_action_req` SSE event, and the browser renders a UI for the user to complete a real-world action (OAuth login, resource selection, deployment approval). When the user finishes, the result is POSTed to `/api/converse/resume` and the agent continues.

### Full UserAction catalog

| Wire Name | Pack | Description |
|---|---|---|
| `github:login` | pack-github | GitHub OAuth popup |
| `github:pick_org` | pack-github | Select a GitHub organization |
| `github:pick_repo` | pack-github | Select a GitHub repository |
| `github:create_repo` | pack-github | Create a new GitHub repository |
| `github:create_pr` | pack-github | Create a pull request |
| `github:set_secret` | pack-github | Set a GitHub Actions secret |
| `azure:select_subscription` | pack-azure | Select an Azure subscription |
| `azure:deploy_resource` | pack-azure | Deploy a specific Azure resource |
| `azure:deploy` | pack-azure | High-level deploy flow |
| `azure:delete_resource` | pack-azure | Delete an Azure resource |
| `azure:update_resource` | pack-azure | Update an Azure resource |
| `aks:deploy` | pack-aks-automatic | AKS Automatic deployment |

### Flow

```
Agent calls a UserAction tool
  → Runner sets session.pendingUserAction
  → SSE emits `user_action_req` to the browser
  → Browser renders the matching UI component
  → User completes the interaction (login, pick, approve)
  → Client POSTs result to /api/converse/resume
  → Server validates result against UserAction.resultSchema
  → Runner clears pendingUserAction (compare-and-swap)
  → Agent resumes with the result
```

---

## A2UI Component Catalog

The agent emits UI via the `core.emit_ui` tool, which produces structured JSON (A2UI v0.9 format). The client renders these into rich interactive elements inside chat.

### Fluent primitives

Available as low-level building blocks: `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`, `Link`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`, `ComboBox`, `MultiSelect`, `Toggle`, `RadioGroup`, `Table`, `Alert`, `Badge`, `Accordion`, `Card`, `Modal`, `Tabs`, `Divider`, `Row`, `Column`, `List`

### Rich domain components

| Component | Registered by | Schema highlights |
|---|---|---|
| **Questionnaire** | pack-core | `questions[]` with `id`, `label`, `type` (text/choice/multiChoice), `choices[]`, `required`; `submitLabel`; `onSubmit` action |
| **FileEditor** | pack-core | Monaco-based inline code editor for generated files |
| **GenerationProgress** | pack-core | `steps[]` with `id`, `label`, `status`; `overallStatus`; `runId` for deploy polling; `appUrl`/`portalUrl` links |
| **DecisionCard** | pack-core | `title`, `recommendation`, `rationale`, `alternatives[]`, `badge` |
| **SummaryCard** | pack-core | `title`, `items[]` with `label`, `value`, `badge` |
| **CodeBlock** | pack-core | Syntax-highlighted code display |
| **ProgressSteps** | pack-core | `steps[]` with `id`, `label`, `status` (pending/active/complete/error) |
| **CostEstimate** | web catalog | Resource rows with `name`, `sku`, `monthlyEstimate`, `skuOptions[]`, `pricingTiers[]`; pricing line items by kind (AKS, ACR, OpenAI, storage, etc.); phase-gated approve button |
| **AzureLoginCard** | web catalog | `displayName`, `showTokenInfo`, `onSignIn`/`onSignOut` actions |
| **GitHubLoginCard** | web catalog | GitHub OAuth login card |
| **AzureResourcePicker** | web catalog | `subscriptionId`, `resourceGroup`, `resourceType`, `location` filters; `onSelect` action |
| **AzureResourceForm** | web catalog | Azure resource configuration form |
| **GitHubRepoPicker** | web catalog | `placeholder`, `owner`, `allowCreate`, `onSelect`/`onCreate` actions |
| **AzureAction** | web catalog | Azure deployment action/progress |
| **GitHubAction** | web catalog | GitHub action (PR, secrets) |
| **GitHubCommit** | web catalog | Commit display |
| **AuthCard** | web catalog | Generic authentication card |
| **Markdown** | web catalog | Rich markdown rendering |
| **FormGroup** | web catalog | Grouped form fields |
| **SteppedCarousel** | web catalog | Multi-step carousel |

### Surface lifecycle

The `core.emit_ui` tool manages surfaces with four operations:

| Operation | Behavior |
|---|---|
| `createSurface` | Creates a new A2UI surface. Rejects duplicates. Rejects if `liveSurfaceIds >= maxLiveSurfaces`. |
| `updateComponents` | Updates components on an existing surface. Rejects if surface doesn't exist. |
| `updateDataModel` | Updates the data model of an existing surface. |
| `deleteSurface` | Removes a surface. Rejects if surface doesn't exist. |

---

## Agent Tools

Function-calling tools available to the LLM during conversation:

| Tool | Purpose |
|---|---|
| `core.emit_ui` | Emit A2UI surfaces (primary UI rendering tool) |
| `read_skill` | Read harness skill/artifact content |
| `search_components` | Discover available A2UI components before emitting |
| `fetch_webpage` | Fetch external web content for reference |
| `read_file` | Read a file from the virtual filesystem |
| `write_file` | Write a file to the virtual filesystem |
| `list_files` | List files in the virtual filesystem |
| `validate_artifacts` | Validate generated project files |

---

## Guardrails

Cross-cutting checks that run at input, tool-call, and output stages:

| Guardrail | Source | Purpose |
|---|---|---|
| `token_budget` | pack-core | Enforces token/cost limits per turn |
| `no_pii_in_logs` | pack-core | Detects and strips PII from logs and outputs |
| `no_secrets_in_artifacts` | pack-core | Blocks secrets from appearing in generated files |
| `no-credential-leak` | pack-core | Prevents credential exposure in any output |

---

## Key Files

| Area | Path |
|---|---|
| Landing page | `packages/web/src/components/Landing.tsx` |
| Phase definitions | `packages/harness/src/index.ts` (canonical), `packages/web/src/utils/chat-a2ui.ts` (client) |
| Phase stepper UI | `packages/web/src/components/Chat/ChatShell.tsx` |
| Phase SSE handling | `packages/web/src/hooks/useStreaming.ts` |
| A2UI surface renderer | `packages/web/src/vendor/a2ui/react/A2uiSurface.tsx` |
| A2UI hook | `packages/web/src/hooks/useA2UI.ts` |
| Component catalog (fluent) | `packages/web/src/catalog/fluent-components/` |
| Component catalog (rich) | `packages/web/src/catalog/components/` |
| Component registration | `packages/web/src/bootstrap/registerPackComponents.ts` |
| emit_ui tool | `packages/pack-core/src/tools/emit_ui.ts` |
| UserAction type | `packages/harness/src/types/user-action.ts` |
| UserAction resume | `packages/harness/src/runtime/resume.ts` |
| Azure user-actions | `packages/pack-azure/src/user-actions/` |
| GitHub user-actions | `packages/pack-github/src/user-actions/` |
| AKS user-actions | `packages/pack-aks-automatic/src/user-actions/` |
| Guardrails | `packages/pack-core/src/guardrails/` |
| Runner (agent loop) | `packages/harness/src/runtime/runner.ts` |
| SSE adapter | `packages/harness/src/runtime/sse.ts` |
| Playground | `packages/web/src/pages/Playground.tsx` |
