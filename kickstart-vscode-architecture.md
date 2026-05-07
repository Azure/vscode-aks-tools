# Kickstart VS Code Architecture

> How the `@kickstart` chat participant, webview dashboard, and supporting infrastructure work together to take a user from source code to a running app on AKS.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        VS Code                               │
│                                                              │
│  ┌─────────────────┐    ┌─────────────────────────────────┐  │
│  │  Chat Panel      │    │  Webview Dashboard              │  │
│  │  @kickstart      │    │  (React)                        │  │
│  │                  │    │                                 │  │
│  │  stream.markdown │◄──►│  PhaseProgress                 │  │
│  │  stream.button   │    │  StatusChecks                   │  │
│  │  stream.anchor   │    │  ModulesPanel                   │  │
│  │  stream.progress │    │  ArtifactsPanel                 │  │
│  └────────┬─────────┘    │  ArmResourcesPanel              │  │
│           │              │  AuditLog                        │  │
│           ▼              └──────────┬──────────────────────┘  │
│  ┌────────────────┐                 │                         │
│  │  handler.ts     │    stateChanged│(postMessage)            │
│  │  (chat handler) │◄───────────────┘                         │
│  └────────┬────────┘                                          │
│           │                                                   │
│           ▼                                                   │
│  ┌────────────────┐    ┌───────────────┐   ┌──────────────┐  │
│  │  phaseRunner    │───►│  LMClient     │──►│  Copilot LM  │  │
│  │  (dispatcher)   │    │  (LM wrapper) │   │  (GPT-4o)    │  │
│  └────────┬────────┘    └───────────────┘   └──────────────┘  │
│           │                                                   │
│           ▼                                                   │
│  ┌────────────────────────────────────────────────┐           │
│  │  Phase Implementations                         │           │
│  │  analyze → configure → prepare → build →       │           │
│  │  deploy → verify                               │           │
│  └────────┬───────────────────────────────────────┘           │
│           │                                                   │
│           ▼                                                   │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │  Container Assist │  │  Azure ARM   │  │  kubectl      │   │
│  │  SDK (npm)        │  │  SDK clients │  │  (k8s tools)  │   │
│  └──────────────────┘  └──────────────┘  └───────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## Entry Points

Users can start kickstart in 4 ways:

| Entry Point | Command | What Happens |
|---|---|---|
| Chat: type `@kickstart` | — | `defaultHandler` runs, shows welcome or resume prompt |
| Command Palette: "AKS: Kickstart Containerization" | `aks.kickstartContainerization` | Opens webview panel (KickstartPanel) |
| AKS tree: right-click cluster → "Kickstart" | `aks.kickstartContainerization` | Opens webview panel with pre-selected cluster |
| Walkthrough: "Start Kickstart" button | `aks.kickstart.openChat` | Opens chat with `@kickstart` |

On first activation with `aks.kickstartEnabledPreview` enabled, the walkthrough auto-opens via `globalState("kickstart.welcomeShown")`.

---

## State Management

### Where State Lives

```
context.workspaceState
  └── kickstart.state.${workspaceFolderPath}  →  KickstartState
```

State is keyed by the workspace folder path and persisted via `context.workspaceState` (survives VS Code restarts, scoped to the workspace).

### State Shape

```typescript
interface KickstartState {
    currentPhase: Phase;           // 0=ANALYZE .. 6=COMPLETE
    workspaceFolder: string;       // state storage key
    projectPath?: string;          // actual repo on disk (may differ from workspace)
    projectSource?: "workspace" | "sample" | "custom";

    analysis?: AnalysisData;       // language, framework, modules, ports, existing files
    config?: ConfigData;           // subscription, cluster, ACR, SKU, permissions
    artifacts?: ArtifactsData;     // generated Dockerfile + manifests, savedToDisk flag
    image?: ImageData;             // repository + tag after build
    deployment?: DeploymentData;   // applied manifests + timestamp
    verification?: VerificationData; // pod health + service endpoint

    lastError?: ErrorInfo;         // phase, message, retryable
    auditLog?: CommandLogEntry[];  // ⚠️ DEFINED BUT NOT YET POPULATED — see Observability section
    armResources?: ArmResource[];  // ⚠️ DEFINED BUT NOT YET POPULATED — see Observability section
}
```

### State Flow

```
User says "@kickstart analyze"
    │
    ▼
handler.ts
    ├── loadState(context, workspaceFolder)
    ├── detectIntent(prompt, command, state) → { action: "run", phase: ANALYZE }
    ├── validatePrereqs(ANALYZE, state) → ok
    ├── executePhase(ANALYZE, state, stream, token, request)
    │       │
    │       ▼ phaseRunner.ts
    │       └── analyzePhase(projectFolder, stream, token, request)
    │               └── returns { ok: true, analysis: {...} }
    │
    ├── state.analysis = result.analysis
    ├── state.currentPhase = CONFIGURE
    ├── saveState(context, workspaceFolder, state)  ← persists to workspaceState
    ├── KickstartPanel.pushState(state)             ← sends stateChanged to webview
    └── stream.button("Next: Configure")            ← shows button in chat
```

---

## Phase Pipeline

### Phase Execution Order

```
🔍 Analyze  →  ⚙️ Configure  →  📦 Prepare  →  🔨 Build  →  🚀 Deploy  →  ✅ Verify
```

Each phase has **entry prerequisites** validated by `validatePrereqs()`:

| Phase | Requires |
|---|---|
| ANALYZE | — |
| CONFIGURE | `state.analysis` |
| PREPARE | `state.config` |
| BUILD | `state.artifacts.savedToDisk === true` |
| DEPLOY | `state.image` |
| VERIFY | `state.deployment` |

### Phase Traversal — How the Handler Drives Advancement

The handler (`handler.ts`) is the single entry point for every `@kickstart` chat message. It implements a state machine:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          handler.ts                                  │
│                                                                      │
│  1. loadState() or create initial                                    │
│  2. Check for pendingSamplePath (globalState) → set projectPath      │
│  3. Determine intent:                                                │
│     ├── empty prompt + existing session → "Resume or Start new?"     │
│     ├── empty prompt + no session → Welcome screen                   │
│     ├── keyword/command → detectIntent() → { action, phase }         │
│  4. If action == "run":                                              │
│     ├── Set projectPath if missing (defaults to workspace)           │
│     ├── validatePrereqs(phase, state)                                │
│     │   ├── FAIL → show missing prereqs + button to run suggested    │
│     │   └── PASS ↓                                                   │
│     ├── executePhase(phase, state, stream, token, request)           │
│     │   ├── phaseRunner dispatches to correct phase function         │
│     │   ├── Phase uses state.projectPath for filesystem operations   │
│     │   └── Returns PhaseResult + phase-specific data                │
│     ├── On success:                                                  │
│     │   ├── Merge result data into state (analysis/config/etc)       │
│     │   ├── Advance state.currentPhase = phase + 1                   │
│     │   ├── saveState() → persist to workspaceState                  │
│     │   ├── KickstartPanel.pushState() → update webview              │
│     │   └── Show "Next" button (or "Save all" if artifacts unsaved)  │
│     └── On failure:                                                  │
│         ├── state.lastError = { phase, message, retryable }          │
│         ├── saveState() + pushState()                                │
│         ├── Show error + "Retry" button                              │
│         └── Show fixCommand button if available (e.g. "Run az login")│
│  5. If action == "reset" → clearState, start fresh                   │
│  6. If action == "status" → show progress + summary                  │
│  7. If action == "create" → show cluster creation options             │
└─────────────────────────────────────────────────────────────────────┘
```

**Phase advancement is always forward.** `state.currentPhase` only increases (phase + 1 on success). The user can jump to any phase explicitly ("@kickstart configure") but the handler validates prerequisites first. Jumping backward is supported via `jumpToPhase()` which clears all downstream state.

**The "Next" button is phase-aware:**
- After PREPARE: shows "💾 Save all files" if `artifacts.savedToDisk === false`, otherwise "Next: Build"
- After VERIFY (COMPLETE): shows "🌐 Open app" + "☁️ Open in Azure Portal" links
- All other phases: shows "Next: {phase}" button

### Phase Details

#### Analyze (`phases/analyze.ts`)

**Purpose:** Detect project language, framework, modules, ports, entry points, existing artifacts.

**APIs called:**
- `analyzeRepo()` — Container Assist SDK (`containerization-assist-mcp/sdk`). Uses `node:fs` to scan the project directory (readdir, readFile). Takes `repositoryPath` string.
- Fallback: `request.model.sendRequest()` — direct VS Code LM API call. Sends directory tree to Copilot with an inline prompt asking it to identify deployable modules as JSON.

**Data produced:** `AnalysisData` (language, framework, ports, entryPoint, modules[], isMonorepo, existing Dockerfile/manifest/workflow flags).

#### Configure (`phases/configure.ts`)

**Purpose:** Select Azure subscription, AKS cluster, ACR. Run pre-flight checks.

**APIs called:**
- `getReadySessionProvider()` → Azure auth
- `getSubscriptions()` → `SubscriptionClient.subscriptions.list()`
- `getResources(sub, clusterResourceType)` → `ResourceManagementClient.resources.list()`
- `getResources(sub, acrResourceType)` → same client, different type
- `getManagedCluster()` → `ContainerServiceClient.managedClusters.get()`
- `listClusterUserCredentials()` → kubeconfig access check
- `checkKickstartPermissions()` → `AuthorizationManagementClient.roleAssignments.listForResource()` for AcrPull check
- `fetchAzurePrice()` → public `https://prices.azure.com/api/retail/prices` for cost estimation

**UI:** QuickPick flow (subscription → cluster → ACR). Shows architecture summary, pre-flight checks, cost estimate.

**Data produced:** `ConfigData` (subscriptionId, resourceGroup, clusterName, clusterSku, acrName, acrLoginServer, canGetKubeconfig, hasAcrPull).

#### Prepare (`phases/prepare.ts`)

**Purpose:** Generate Dockerfile and Kubernetes manifests using AI.

**APIs called (LLM):**
1. `LMClient.ensureModel()` — selects a Copilot language model
2. `sdkGenerateDockerfile()` — Container Assist SDK generates a `DockerfilePlan` (analysis + knowledge base, no LLM)
3. `LMClient.sendRequestWithTools(DOCKERFILE_SYSTEM_PROMPT, buildDockerfileUserPrompt(plan), PROJECT_TOOLS)` — Copilot generates the actual Dockerfile using the plan + project file access
4. `sdkGenerateK8sManifests()` — Container Assist SDK generates a `ManifestPlan`
5. `LMClient.sendRequestWithTools(K8S_MANIFEST_SYSTEM_PROMPT, buildK8sManifestUserPrompt(plan), PROJECT_TOOLS)` — Copilot generates manifests

**AKS Automatic adaptations** (applied post-generation):
- Remove resource requests/limits
- Change ingress class to `webapprouting`
- Skip HPA manifest

**Data produced:** `ArtifactsData` (dockerfile, manifests[], savedToDisk=false).

#### Build (`phases/build.ts`)

**Purpose:** Build container image and push to ACR.

**APIs called:**
- `exec("az acr build --registry ... --image ... <path>")` — shell command via `src/commands/utils/shell.ts`
- `exec("az acr repository show-tags ...")` — verify image was pushed

**Data produced:** `ImageData` (repository, tag).

#### Deploy (`phases/deploy.ts`)

**Purpose:** Apply Kubernetes manifests to the cluster.

**APIs called:**
- `getAuthenticatedKubeconfigYaml()` — injects VS Code auth token into kubeconfig exec block (uses `vscode.authentication.getSession` for MSAL token, writes kubelogin cache)
- `invokeKubectlCommand("apply -f <manifestsDir>")` — via `vscode-kubernetes-tools-api`
- `invokeKubectlCommand("get all -A")` — list deployed resources

**Data produced:** `DeploymentData` (appliedManifests[], timestamp).

#### Verify (`phases/verify.ts`)

**Purpose:** Check pod health, service endpoints, logs.

**APIs called:**
- `invokeKubectlCommand("get pods -l app=<name> -o json")`
- `invokeKubectlCommand("get svc <name> -o json")`
- `invokeKubectlCommand("logs <podName>")`

**Data produced:** `VerificationData` (podsReady, serviceEndpoint).

---

## LLM Integration

### Architecture

```
┌────────────────────────────────┐
│  LMClient (lmClient.ts)        │
│                                │
│  ensureModel()                 │  ← selects Copilot model via vscode.lm.selectChatModels
│  sendRequest(sys, user)        │  ← simple prompt → response
│  sendRequestWithTools(         │  ← prompt + tools → multi-round conversation
│    sysPrompt, userPrompt,      │
│    { tools, toolHandler },     │
│    token                       │
│  )                             │
│                                │
│  Max 20 tool rounds            │
│  Messages: User(sys) + User(u) │  ← both sent as User role
└──────────────┬─────────────────┘
               │
               ▼
┌────────────────────────────────┐
│  PROJECT_TOOLS (tools.ts)      │
│                                │
│  readProjectFile               │  ← reads via vscode.workspace.fs.readFile
│    path traversal check        │     max 200 lines, blocked patterns (.env, .key, etc)
│    blocked file patterns       │
│                                │
│  listDirectory                 │  ← walks via vscode.workspace.fs.readDirectory
│    excludes node_modules etc   │     max depth 3, max 200 entries
└────────────────────────────────┘
```

### Call Sites

| File | Method | System Prompt | Tools |
|---|---|---|---|
| `steps/dockerfile.ts` | `sendRequestWithTools` | `DOCKERFILE_SYSTEM_PROMPT` | `PROJECT_TOOLS` |
| `steps/manifests.ts` | `sendRequestWithTools` | `K8S_MANIFEST_SYSTEM_PROMPT` | `PROJECT_TOOLS` |
| `steps/githubActions.ts` | `sendRequestWithTools` | `"You are a GitHub Actions expert."` | `[]` (none) |
| `phases/analyze.ts` | `request.model.sendRequest` (direct) | Inline "project structure analyzer" | None |

### Response Parsing (`contentParser.ts`)

The LM is instructed to wrap output in `<content>` markers. The parser:

1. Looks for `<content>...</content>` markers → extracts inner text
2. Looks for `<content filename="deployment.yaml">...</content>` → extracts per-file
3. Fallback: strips markdown fences (` ```dockerfile `, ` ```yaml `)
4. For manifests: splits YAML documents by `---`, infers filenames from `kind:` field
5. `fixManifestImageReferences()` rewrites image references to use the actual ACR login server

---

## Azure API Integration

### Authentication

```
vscode.authentication.getSession("microsoft", scopes)
    │
    ▼
AzureSessionProvider (azureSessionProvider.ts)
    │
    ▼
getReadySessionProvider() → ReadyAzureSessionProvider
    │
    ▼
getCredential(sessionProvider) → TokenCredential
    │
    ▼
get*Client(sessionProvider, subscriptionId) → Azure SDK client
```

### SDK Clients Used

| Client | Constructor (arm.ts) | Used For |
|---|---|---|
| `SubscriptionClient` | `getSubscriptionClient()` | List subscriptions |
| `ResourceManagementClient` | `getResourceManagementClient()` | List clusters/ACRs by resource type |
| `ContainerServiceClient` | `getAksClient()` | Get cluster details, kubeconfig |
| `ContainerRegistryManagementClient` | `getAcrManagementClient()` | ACR registry operations |
| `AuthorizationManagementClient` | `getAuthorizationManagementClient()` | Role assignment CRUD (AcrPull check/attach) |

### kubectl Integration

```
vscode-kubernetes-tools-api
    │
    ▼
kubectl.api.invokeCommand(command, kubeconfigPath)
    │
    ▼
invokeKubectlCommand() / getKubectlJsonResult()  (kubectl.ts wrappers)
```

Kubeconfig authentication for AKS uses a custom exec plugin flow:
1. Get raw kubeconfig via `listClusterUserCredentials`
2. `getAuthenticatedKubeconfigYaml()` rewrites the exec block to use extension-managed kubelogin + cached MSAL token
3. Write to temp file → pass to kubectl

---

## Terminal Command Execution

Kickstart uses VS Code's **built-in `runInTerminal` tool** to execute shell commands visibly in the chat UI. This replaced the earlier pattern of hidden `child_process.exec()` calls.

### How It Works

```
Phase (build.ts / deploy.ts)
    │
    ▼
terminalTool.ts: runInTerminal(command, cwd, token, toolInvocationToken)
    │
    ▼
vscode.lm.invokeTool("runInTerminal", {
    input: { command, cwd },
    toolInvocationToken    ← links execution to the chat conversation
}, token)
    │
    ▼
VS Code built-in terminal tool
    ├── Opens integrated terminal
    ├── Runs command via shell integration
    ├── Streams output into chat UI (collapsible)
    ├── Auto-collapses on success
    └── Auto-expands on failure
```

### Command Visibility

| Phase | Command | Execution Method | Visible to User |
|---|---|---|---|
| Build | `az acr build --registry ...` | `runInTerminal` | ✅ Visible in chat |
| Build | `az acr repository show-tags ...` | `runInTerminal` | ✅ Visible in chat |
| Deploy | `kubectl apply -f ...` | `runInTerminal` | ✅ Visible in chat |
| Deploy | `kubectl get all -A` | `runInTerminal` | ✅ Visible in chat |
| Deploy | `kubectl config view` | `kubectl.api.invokeCommand` | ❌ Hidden (data-gathering) |
| Verify | `kubectl get pods -o json` | `kubectl.api.invokeCommand` | ❌ Hidden (JSON parsing) |
| Verify | `kubectl get svc -o json` | `kubectl.api.invokeCommand` | ❌ Hidden (JSON parsing) |
| Verify | `kubectl logs ...` | `kubectl.api.invokeCommand` | ❌ Hidden (parsed for error detection) |

Commands that need structured output (JSON parsing, error pattern matching) stay hidden via the kubectl extension API. User-facing commands that produce human-readable output use the terminal tool.

---

## Observability: Audit Log & ARM Resource Tracking

### Current Status: ⚠️ Defined but Not Yet Populated

The state model defines `auditLog: CommandLogEntry[]` and `armResources: ArmResource[]`. The webview has React components (`AuditLog.tsx`, `ArmResourcesPanel.tsx`) that render these. `KickstartPanel.pushState()` forwards them to the webview. **However, no code currently writes to either field.**

### CommandLogEntry (audit log)

```typescript
interface CommandLogEntry {
    command: string;      // e.g. "az acr build --registry myacr ..."
    timestamp: number;
    exitCode?: number;
    stdout?: string;      // truncated to 500 chars
    stderr?: string;      // truncated to 500 chars
    phase: Phase;
    durationMs?: number;
}
```

**To implement:** Wrap `runInTerminal()` to record entries. After each terminal command, create a `CommandLogEntry` and append to `state.auditLog`, then `saveState()` + `pushState()`.

### ArmResource (Azure resource tracking)

```typescript
interface ArmResource {
    type: string;         // e.g. "Microsoft.ContainerRegistry/registries"
    name: string;         // e.g. "myacr"
    resourceGroup: string;
    action: "used" | "created" | "modified";
}
```

**To implement:** After configure phase selects resources, record them as "used". After attach-ACR creates a role assignment, record as "modified". Track in `state.armResources`.

### shell.ts Command Logger (not connected)

`shell.ts` defines `setCommandLogger()` and `activeCommandLogger` — a global hook for `exec()` calls. This is **not connected** to kickstart because:
1. Kickstart phases use `runInTerminal` (VS Code LM tool), not `shell.exec()`
2. `setCommandLogger()` is never called anywhere in the codebase

This mechanism is vestigial for kickstart but may be used by other parts of the extension.

---

## Webview Dashboard

### Extension → Webview Communication

```
handler.ts
    │ saveState(context, folder, state)    ← persist to workspaceState
    │ KickstartPanel.pushState(state)      ← send to webview
    │
    ▼
KickstartPanel.ts
    │ currentWebview.postStateChanged({
    │     currentPhase, analysis, config, artifacts,
    │     image, deployment, verification, lastError,
    │     auditLog, armResources
    │ })
    │
    ▼ (window.postMessage)
    │
webview-ui/src/Kickstart/state.ts
    │ vscode.subscribeToMessages({ stateChanged: (args) => setState(...) })
    │
    ▼
Kickstart.tsx  →  child components re-render
```

### React Components

| Component | Props | Renders |
|---|---|---|
| `Kickstart.tsx` | (root) | Session card, routes to children |
| `PhaseProgress.tsx` | `currentPhase`, `hasError` | Horizontal phase stepper with icons |
| `StatusChecks.tsx` | `config`, `analysis`, `artifacts`, `image`, `deployment`, `verification` | Collapsible pass/fail check list |
| `ModulesPanel.tsx` | `modules[]` | Table of detected apps (name, language, framework, path, port) |
| `ArtifactsPanel.tsx` | `artifacts` | Collapsible file list with "Open in Editor" buttons |
| `ArmResourcesPanel.tsx` | `armResources[]` | Table of Azure resources (type, name, action badge) |
| `AuditLog.tsx` | `auditLog[]` | Chronological command log with expandable stdout/stderr |

### Webview → Extension Messages

| Message | Payload | Handler |
|---|---|---|
| `getSubscriptionsRequest` | — | Lists Azure subscriptions |
| `getResourceGroupsRequest` | `{ subscriptionId }` | Lists resource groups |
| `getClustersRequest` | `{ subscriptionId, resourceGroup? }` | Lists AKS clusters |
| `getAcrsRequest` | `{ subscriptionId, resourceGroup? }` | Lists ACRs |
| `getPermissionStatusRequest` | `{ clusterKey, acrKey }` | Checks AcrPull permission |
| `attachAcrRequest` | `{ clusterKey, acrKey }` | Creates AcrPull role assignment |
| `startKickstartRequest` | `{ clusterKey, acrKey }` | Closes panel, opens chat |
| `openArtifactRequest` | `{ filename, content }` | Opens file in VS Code editor |

---

## Registered Commands

All gated by `config.aks.kickstartEnabledPreview`:

| Command | Action |
|---|---|
| `aks.kickstartContainerization` | Open webview panel |
| `aks.kickstart.openChat` | Open chat with `@kickstart` |
| `aks.kickstart.useWorkspace` | Set projectPath to workspace, open chat |
| `aks.kickstart.useSample` | QuickPick sample repos, clone to temp, open chat |
| `aks.kickstart.createNew` | Track/framework picker, open chat with context |
| `aks.kickstart.resume` | Open chat with `@kickstart resume` |
| `aks.kickstart.newSession` | Open chat with `@kickstart start over` |
| `aks.kickstart.analyze` | Open chat with `@kickstart analyze` |
| `aks.kickstart.configure` | Open chat with `@kickstart configure` |
| `aks.kickstart.prepare` | Open chat with `@kickstart generate` |
| `aks.kickstart.build` | Open chat with `@kickstart build` |
| `aks.kickstart.deploy` | Open chat with `@kickstart deploy` |
| `aks.kickstart.verify` | Open chat with `@kickstart verify` |
| `aks.kickstart.retry` | Open chat with `@kickstart retry` |
| `aks.kickstart.saveFile` | Save single generated file to disk |
| `aks.kickstart.saveAll` | Save all generated files to disk |
| `aks.kickstart.buildAndPush` | Open terminal with `az acr build` |

---

## Chat Participant

### Registration (`participant.ts`)

```typescript
vscode.chat.createChatParticipant("ms-kubernetes-tools.kickstart", defaultHandler)
```

- **Icon:** `resources/aks-tools.png`
- **isSticky:** true (stays selected across messages)
- **Slash commands:** `/start`, `/sample`

### Intent Detection (`intent.ts`)

| Input | Detected Intent |
|---|---|
| `/start` (no state) | `run ANALYZE` |
| `/start` (has state) | Resume prompt |
| `analyze`, `scan` | `run ANALYZE` |
| `configure`, `select`, `choose cluster` | `run CONFIGURE` |
| `generate`, `dockerfile`, `manifest` | `run PREPARE` |
| `build`, `push` | `run BUILD` |
| `deploy`, `ship`, `apply` | `run DEPLOY` |
| `verify`, `check`, `health` | `run VERIFY` |
| `status`, `where am i`, `progress` | `status` |
| `start over`, `reset`, `restart` | `reset` |
| `resume`, `continue`, `retry` | `run currentPhase` |
| `create cluster`, `new cluster` | `create` |
| (empty or unmatched) | `run currentPhase` |

### Followup Provider

After each phase completion, clickable followup suggestions appear:

| After Phase | Followup |
|---|---|
| ANALYZE | "Configure Azure resources" |
| CONFIGURE | "Generate deployment files" |
| PREPARE | "Build & push image" |
| BUILD | "Deploy to AKS" |
| DEPLOY | "Verify deployment" |
| VERIFY / COMPLETE | "Check status", "Start over" |
| Any error | "Retry", "Check status" |

---

## Container Assist SDK

The `containerization-assist-mcp` npm package provides:

| Function | Purpose | Filesystem Access |
|---|---|---|
| `analyzeRepo()` | Detect language, framework, modules, ports | `node:fs` (readdir, readFile) |
| `generateDockerfile()` | Generate a `DockerfilePlan` (analysis + knowledge base) | `node:fs` (reads project files) |
| `generateK8sManifests()` | Generate a `ManifestPlan` | `node:fs` (reads project files) |

These functions use **raw Node.js `fs`** — they require a real on-disk path. Virtual filesystems won't work. The SDK produces **plans** (structured data), not final artifacts. The plans are then fed to Copilot via `LMClient.sendRequestWithTools()` to generate the actual Dockerfile/manifest content.

---

## User Stories

### Story 1: Containerize Existing Workspace

```
1. User opens a Node.js project in VS Code
2. Types @kickstart in chat
3. Welcome screen → clicks "📂 Use existing repo"
4. handler sets projectPath = workspace folder
5. ANALYZE: SDK scans project → detects Node.js/Express on port 3000
6. Chat shows analysis table + "Next: Configure" button
7. CONFIGURE: QuickPick → pick subscription → pick cluster → pick ACR
8. Pre-flight checks shown (kubeconfig ✅, AcrPull ✅)
9. Cost estimate shown (~$145/mo)
10. "Next: Prepare" button
11. PREPARE: SDK generates DockerfilePlan → Copilot generates Dockerfile
12. SDK generates ManifestPlan → Copilot generates deployment.yaml + service.yaml
13. Save buttons appear per file → user clicks "Save all"
14. "Next: Build" button appears (only after save)
15. BUILD: `az acr build` runs → image pushed to ACR
16. "Next: Deploy" button
17. DEPLOY: kubeconfig obtained → `kubectl apply -f k8s/` → manifests applied
18. "Next: Verify" button
19. VERIFY: pods checked → service endpoint found → "Open app" link shown
20. 🎉 Done
```

### Story 2: Try with Sample Repo

```
1. User types @kickstart (no workspace open or with existing workspace)
2. Welcome screen → clicks "📦 Use sample repo"
3. QuickPick: AKS Store Demo / Azure Voting App / Contoso Real Estate
4. Clone to /tmp/kickstart-samples/aks-store-demo (no window reload)
5. handler picks up pendingSamplePath from globalState
6. Sets state.projectPath = temp dir, projectSource = "sample"
7. Same flow as Story 1, but operating on the temp dir
8. User's workspace is untouched
```

### Story 3: Resume Previous Session

```
1. User types @kickstart (existing session at PREPARE phase)
2. Handler detects existing progress
3. Shows "▶️ Resume (Prepare)" and "✨ Start new session" buttons
4. User clicks Resume → continues from PREPARE phase
5. Or clicks Start new → state cleared, welcome screen shown
```

### Story 4: Error Recovery

```
1. BUILD phase fails: "az acr build" returns error
2. Handler shows error classification + "🔄 Retry" button
3. If auth error: also shows "Run az login" fixCommand button
4. User fixes issue, clicks Retry → phase re-runs
```

---

## File Map

```
src/
├── chatParticipants/kickstart/
│   ├── config.ts              # Constants: sample repos, participant ID
│   ├── config.test.ts         # Sanity tests for constants
│   ├── handler.ts             # Main chat handler (entry point for all messages)
│   ├── intent.ts              # Keyword → phase intent detection
│   ├── participant.ts         # Chat participant registration + followup provider
│   ├── state.ts               # KickstartState type + load/save/clear/jumpToPhase
│   ├── state.test.ts          # State management tests
│   ├── phaseRunner.ts         # Phase dispatcher + prereq validation + error classification
│   ├── phaseRunner.test.ts    # Phase validation tests
│   ├── progress.ts            # Phase progress bar rendering
│   ├── telemetry.ts           # Telemetry helper
│   ├── terminalTool.ts        # runInTerminal wrapper (vscode.lm.invokeTool)
│   ├── gitExtension.ts        # Git clone wrapper (vscode.git API)
│   ├── gitExtension.test.ts   # Git clone tests
│   ├── orchestrator.ts        # ⚠️ DEAD CODE — legacy linear orchestrator, not imported anywhere
│   ├── phases/
│   │   ├── analyze.ts         # Project analysis (SDK + LM fallback)
│   │   ├── configure.ts       # Azure resource selection + pre-flight + cost
│   │   ├── prepare.ts         # Artifact generation (SDK plans → Copilot)
│   │   ├── build.ts           # az acr build via runInTerminal
│   │   ├── deploy.ts          # kubectl apply via runInTerminal
│   │   └── verify.ts          # Pod/service/log health checks (kubectl API)
│   └── steps/
│       ├── analyze.ts         # analyzeRepo SDK wrapper (used by phases/analyze.ts)
│       ├── dockerfile.ts      # Dockerfile generation step (used by phases/prepare.ts)
│       ├── manifests.ts       # Manifest generation step (used by phases/prepare.ts)
│       └── githubActions.ts   # ⚠️ DEAD CODE — only imported by orchestrator.ts
│
├── commands/aksKickstart/
│   ├── configure.ts           # QuickPick configuration flow
│   ├── repoSource.ts          # useWorkspace() + useSample() (temp dir clone)
│   ├── buildAndPush.ts        # Terminal-based az acr build (registered command)
│   ├── deploy.ts              # ⚠️ DEAD CODE — not imported or registered anywhere
│   ├── saveFile.ts            # Single file save with path traversal check
│   └── saveAll.ts             # Batch file save with overwrite confirmation
│
├── commands/aksContainerAssist/
│   ├── lmClient.ts            # LMClient wrapper (ensureModel, sendRequestWithTools)
│   ├── prompts.ts             # System/user prompt templates
│   ├── tools.ts               # PROJECT_TOOLS (readProjectFile, listDirectory)
│   ├── contentParser.ts       # LM response parsing (<content> markers, YAML splitting)
│   └── containerAssistService.ts  # High-level Container Assist orchestrator
│
├── commands/utils/
│   ├── arm.ts                 # Azure SDK client constructors
│   ├── subscriptions.ts       # Subscription listing
│   ├── azureResources.ts      # Resource listing by type
│   ├── clusters.ts            # Cluster operations + kubeconfig auth
│   ├── kubectl.ts             # kubectl command wrappers (used by verify phase)
│   ├── identities.ts          # Cluster principal ID resolution
│   ├── roleAssignments.ts     # Role assignment CRUD
│   ├── acrRoleHelpers.ts      # AcrPull permission check
│   ├── kickstartPermissions.ts # Composite permission check
│   └── shell.ts               # Shell exec wrapper (not used by kickstart phases)
│
├── panels/
│   ├── BasePanel.ts           # Webview panel base class
│   └── KickstartPanel.ts      # Kickstart dashboard panel + message handlers
│
├── webview-contract/
│   └── webviewDefinitions/
│       └── kickstart.ts       # All types + message contracts (single source of truth)
│
└── auth/
    ├── azureAuth.ts           # getReadySessionProvider, getCredential
    └── azureSessionProvider.ts # MSAL session management

webview-ui/src/Kickstart/
├── Kickstart.tsx              # Root dashboard component
├── state.ts                   # Webview message helper + DashboardData type
├── PhaseProgress.tsx          # Phase stepper
├── StatusChecks.tsx           # Pass/fail check list
├── ModulesPanel.tsx           # Detected apps table
├── ArtifactsPanel.tsx         # Generated files list
├── ArmResourcesPanel.tsx      # Azure resources table (⚠️ renders but never receives data)
├── AuditLog.tsx               # Command history log (⚠️ renders but never receives data)
└── Dashboard.module.css       # All dashboard styles
```
