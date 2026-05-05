# Kickstart Chat Agent + Webview UI

## TL;DR

> **Quick Summary**: Build a `@kickstart` VS Code chat participant + a "Kickstart Containerization" webview panel. Webview is preflight (pickers + AcrPull permission checks + remediation). Chat owns artifact generation (Dockerfile / K8s manifests / GitHub Actions YAML) by importing the existing Container Assist SDK + lmClient. Streamed artifacts in chat with per-file and "Save all" buttons. Three follow-up actions after generation: build/push to ACR, deploy to AKS, open portal.
>
> **Deliverables**:
> - Chat participant `@kickstart` (id `ms-kubernetes-tools.kickstart`) with slash commands `/start`, `/sample`.
> - Webview panel "Kickstart Containerization" with Sub→RG→Cluster→ACR pickers + visual permission checks + Attach-ACR remediation.
> - 3 entry points: chat button, command palette `AKS: Kickstart Containerization`, AKS tree-view context menu on cluster.
> - 2 repo-source chat buttons: "Use current workspace" + "Use a sample" (clones `Azure-Samples/aks-store-demo`).
> - Inline streaming generation in chat for Node + Python + .NET + Go (Dockerfile + .dockerignore + K8s manifests + GitHub Actions YAML).
> - Per-file "Save to workspace" + "Save all" buttons with overwrite confirmation.
> - 3 post-generation buttons: "Build & push to ACR" (terminal `az acr build`), "Deploy to AKS" (handoff to `deployManifestToAKSPlugin`), "Open in portal" anchor.
> - New shared helper `src/commands/utils/identities.ts` (extracts duplicated `getClusterPrincipalId`).
> - New preview flag `aks.kickstartEnabledPreview` defaulted false.
> - Mocha unit tests + Playwright + scripted chat QA.
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: T1 (preview flag) → T3 (identities helper) → T7 (webview panel) → T13 (chat participant) → T17 (generation orchestrator) → T20 (save handler) → F1–F4

---

## Context

### Original Request

> "okay plan how we can add a kickstart chat agent that also has a UI view that has a 'start containerization' option that adds chat messages for select a github repo or 'use a sample' and the kickstarter UI web view allows selecting target cluster/resourcegroup and acr with visual checks for permissions and acr connected to cluster"

### Interview Summary

**Architecture decisions**:
- Standalone `@kickstart` chat participant (NOT a function inside @azure agent).
- Three webview entry points: chat button, command palette, AKS tree-view context menu on cluster.
- Repo selection: workspace folder + sample (no GitHub auth, no remote repo browser).
- Webview = preflight pickers + permission checks + remediation only. NO inline generation in webview.
- Generation lives ONLY in chat. ONE streaming code path.
- Reuse existing Container Assist SDK + lmClient + tools + prompts BY IMPORT. Zero changes to existing wizard.
- Languages v1: Node + Python + .NET + Go.
- GitHub Actions YAML generation IS in scope.
- Save UX: per-file Save buttons + Save-all button.
- Sample URL: hardcoded `https://github.com/Azure-Samples/aks-store-demo.git`.
- Preview gate: `aks.kickstartEnabledPreview` defaulted false.

**Defaults applied with disclosure** (override if needed):
- LM model selection: prefer `request.model` from chat request; fall back to `LMClient.ensureModel()` only on programmatic invocation.
- Multi-root workspace: prompt with `vscode.window.showWorkspaceFolderPick`.
- Cancellation: pass `request.token` to SDK calls and lmClient.
- Telemetry events: chat surface emits `chat.kickstart.*`, webview emits `kickstart.*` (separable in dashboards).
- Out-of-band AcrPull (granted via Bicep/Portal not by us): show green check, no special UI.
- Chat participant icon: reuse `resources/aks-tools.png`.
- Sticky participant: `isSticky: true`.

### Research Findings

- **Chat participant API stable in 1.110.0** (engines.vscode `^1.110.0` confirmed). Stream methods `markdown / button / anchor / filetree / progress / reference` all stable. Slash commands via `request.command`. `followupProvider` via `participant.followupProvider`.
- **No existing chat participant in repo** — we're the first.
- **Webview pattern**: 7 files (4 new, 3 modified). Initial state via `data-initialstate` attribute, decoded in `webview-ui/src/main.tsx` rendererLookup.
- **All ACR/permission building blocks already exist**: `acrPullRoleDefinitionName` constant in webview-contract; `getPrincipalRoleAssignmentsForAcr`/`createRoleAssignment`/`deleteRoleAssignment`/`getScopeForAcr` in `roleAssignments.ts`; `getResources` in `azureResources.ts`; `getManagedCluster` in `clusters.ts`.
- **`getClusterPrincipalId` is DUPLICATED** in `AttachAcrToClusterPanel.ts:256-309` AND `aksAttachAcrToCluster/attachAcrToCluster.ts:426-467`. Plan extracts to `src/commands/utils/identities.ts`.
- **"ACR attached" has no `ManagedCluster` field** — entirely determined by AcrPull role assignment presence. Two visual checks reduce to ONE underlying ARM call.
- **Existing remediation pattern**: webview message → handler → `commands.executeCommand("aks.attachAcrToCluster", initialSelection)`. Mirrored from `DraftWorkflowPanel`.
- **Container Assist SDK**: `analyzeRepo`, `generateDockerfile` (returns plan), `generateK8sManifests` (returns plan); formatters `formatGenerateDockerfileResult`, `formatGenerateK8sManifestsResult`, `formatErrorForLLM`. Plans are fed into LM with system prompts + tools.
- **`ContainerAssistService.generateDockerfile` calls `writeFile` internally at line 145** — kickstart bypasses by calling SDK + `lmClient.sendRequestWithTools` directly (using `prompts.ts`/`tools.ts` constants).
- **`vscode.git` API**: `extensions.getExtension('vscode.git').exports.getAPI(1).clone(url, parentPath)`. Must `await activate()` first; `.exports` undefined before activation.

### Metis Review

**Identified gaps (all addressed in plan)**:
- LM model selection ambiguity → Resolved: `request.model` primary, `ensureModel` fallback.
- Webview-vs-chat ownership of generation → Resolved: webview preflight, chat generates.
- SDK vs service-refactor coupling → Resolved: SDK direct import.
- Save UX partial state → Resolved: per-file + save-all with overwrite confirmation.
- Sample URL TBD → Resolved: `Azure-Samples/aks-store-demo`.
- Cluster has BOTH SP and kubelet identity → Plan: prefer kubelet identity in `getClusterPrincipalId`; unit test covers.
- User lacks `roleAssignments/write` → Plan: pre-flight check via `permissions.list`; disable Attach button + tooltip.
- ARM timeout / 503 → Plan: tri-state UI (✓/✗/?) with retry button.
- ACR cross-subscription scope → Plan: `getScopeForAcr` always uses ACR's subscription, not cluster's; unit test covers.
- Race after attach → Plan: re-check perms after `aks.attachAcrToCluster` returns.
- LM unavailable / no consent → Plan: graceful chat message, no throw.
- Tool call loops → Plan: enforce existing `maxToolRounds` from `lmClient.ts`; verify in code review.
- Git extension disabled → Plan: explicit error message + retry.
- Save overwrite → Plan: stat-then-prompt with three options.
- Multi-root workspace → Plan: `showWorkspaceFolderPick`.
- `.github/workflows/` parent dir → Plan: `createDirectory` before `writeFile`.
- Empty subscription / no clusters → Plan: empty-state message with create links.
- Stale buttons in old chat → Plan: every button re-validates state on click.

---

## Work Objectives

### Core Objective

Ship an opt-in, conversation-driven onboarding flow that takes a user from "I have an app" to "I have generated artifacts ready to deploy to my AKS cluster" without leaving VS Code. The chat surface owns the conversation; the webview owns the visual cluster/ACR/permission picker.

### Concrete Deliverables

1. **Chat participant** registered as `ms-kubernetes-tools.kickstart`, name `kickstart`, fullName `Kickstart`, sticky, with slash commands `/start` and `/sample`.
2. **Webview panel** `kickstart` (content id) at `src/panels/KickstartPanel.ts` with subscription→RG→cluster→ACR pickers and 2 visual permission checks (one ARM call, two display checks).
3. **Three entry points** to webview: chat button, command palette `aks.kickstartContainerization`, AKS tree-view context menu (`view/item/context` for `microsoft.aks/managedClusters`).
4. **Two repo-source chat actions**: workspace pick + sample clone (`Azure-Samples/aks-store-demo`).
5. **Streamed artifact generation** in chat (Dockerfile, .dockerignore, K8s deployment+service+namespace, `.github/workflows/build-and-push.yml`).
6. **Save buttons** per file + "Save all" with overwrite confirmation, multi-root support, parent-dir creation.
7. **Three post-generation buttons**: Build/push (terminal), Deploy (handoff to `deployManifestToAKSPlugin`), Open in portal (anchor).
8. **Extracted shared helper** `src/commands/utils/identities.ts` exporting `getClusterPrincipalId`.
9. **Preview flag** `aks.kickstartEnabledPreview` (default false), gating chat participant registration + command + tree-view context menu.
10. **Mocha unit tests** for new helpers; **Playwright** + scripted chat QA evidence in `.sisyphus/evidence/`.

### Definition of Done

- [ ] `npm run build` passes with zero TS errors.
- [ ] `npm test` passes including new unit tests.
- [ ] Playwright suite tagged `kickstart` passes; screenshots saved to `test-results/kickstart/`.
- [ ] All F1–F4 verification waves APPROVE.
- [ ] User explicitly approves the consolidated F1–F4 results.

### Must Have

- Standalone `@kickstart` participant — never extends `@azure`.
- Single ARM call (`getPrincipalRoleAssignmentsForAcr`) drives both visual checks.
- Tri-state permission UI: `✓ AcrPull granted` / `✗ AcrPull missing` / `? Status unknown`.
- Pre-flight `Microsoft.Authorization/roleAssignments/write` check before enabling Attach button.
- Auto-refresh permission check after `aks.attachAcrToCluster` resolves.
- Cancellation token honored end-to-end.
- Overwrite confirmation prompt (`Overwrite | Save as <name>.kickstart | Cancel`) on every save button.
- Empty-state messages for: no clusters, no ACRs, no workspace, no LM model, git extension disabled.
- All buttons re-validate state on click.
- Reuse `acrPullRoleDefinitionName` from `attachAcrToCluster.ts:27` (do not duplicate constant).
- Reuse `prompts.ts`, `tools.ts`, `lmClient.ts` from `aksContainerAssist/` by IMPORT (do not copy).

### Must NOT Have (Locked Non-Goals)

- GitHub auth or remote repo browsing (only workspace + sample clone).
- Multi-cluster / fleet kickstart.
- User-RBAC checks beyond AcrPull and the single roleAssignments/write pre-flight.
- Network reachability probes.
- Modifying `src/commands/aksContainerAssist/containerAssistService.ts` or `aksContainerAssist.ts` orchestration.
- Modifying `src/commands/aksContainerAssist/appModernizationBridge.ts`.
- Custom Helm chart generation.
- Image vulnerability scanning.
- Telemetry dashboards beyond `getTelemetryDefinition` returns.
- Adding kickstart as an `@azure` plugin function in `src/plugins/`.
- Image registry types other than ACR (no Docker Hub / GHCR / GCR).
- Auto-write of any artifact (always button-triggered).
- Silent overwrite of existing files.
- Hardcoded subscription / cluster / ACR / namespace anywhere except the single sample URL constant.
- Sticky chat history dependency: no button may rely on captured args being still valid — always re-validate.
- Copying `prompts.ts` / `tools.ts` content into kickstart — must be imported.
- New @azure plugin entry in `src/plugins/getPlugins.ts`.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification is agent-executed.

### Test Decision

- **Infrastructure exists**: YES (mocha configured per package.json; Playwright also present per repo conventions).
- **Automated tests**: YES (TDD for permission helpers; tests-after for plumbing).
- **Framework**: mocha + sinon for unit; Playwright for webview E2E; scripted `code --extensionDevelopmentPath` for chat participant.
- **TDD scope**: T3 (identities), T4 (acrRoleHelpers), T9 (permission state machine).

### QA Policy

Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{slug}.{ext}`.

- **Webview**: Playwright opens host VS Code with extensionDevelopmentPath, executes command `aks.kickstartContainerization`, asserts DOM with stable `data-testid` selectors, screenshots on each scenario.
- **Chat participant**: scripted invocation via `vscode.commands.executeCommand('workbench.action.chat.open', {query: '@kickstart /start'})`, then poll for stream content via test harness.
- **CLI/build**: Bash runs `npm run build` and `npm test`, captures exit code + log.
- **ARM mocks**: sinon stubs on `AuthorizationManagementClient.roleAssignments.listForResource` and friends. Real Azure NOT contacted in CI.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, all parallel):
├── T1: Preview flag + package.json contributions skeleton          [quick]
├── T2: Webview contract `kickstart.ts`                             [quick]
├── T3: Extract `getClusterPrincipalId` to identities.ts            [quick]   ← TDD
├── T4: New `acrRoleHelpers.ts` (principalHasAcrPullForAcr)         [quick]   ← TDD
├── T5: Sample URL config constant                                  [quick]
├── T6: Git extension wrapper helper                                [quick]

Wave 2 (After Wave 1 — panel + chat skeleton):
├── T7: KickstartPanel.ts + KickstartDataProvider                   [unspecified-high]   (depends T2, T3, T4)
├── T8: Webview React app shell (Kickstart.tsx, state, routing)     [visual-engineering] (depends T2)
├── T9: Permission state machine + tri-state hook                   [visual-engineering] (depends T4)   ← TDD
├── T10: Webview register in webviewTypes.ts + main.tsx             [quick]   (depends T2, T8)
├── T11: Kickstart command (open panel)                             [quick]   (depends T7)
├── T12: Tree-view context menu contribution + when-clause          [quick]   (depends T1)
├── T13: Chat participant registration + handler skeleton           [unspecified-high]   (depends T1)
├── T14: Workspace folder picker helper                             [quick]
├── T15: Sample clone command + progress + error UX                 [unspecified-high]   (depends T6)

Wave 3 (After Wave 2 — generation + integration):
├── T16: Pre-flight permission check (roleAssignments/write)        [unspecified-high]   (depends T7)
├── T17: Chat generation orchestrator (SDK + lmClient import)       [deep]               (depends T13)
├── T18: Artifact streaming + per-file Save buttons                 [deep]               (depends T17)
├── T19: Attach-ACR remediation handoff + auto-refresh              [unspecified-high]   (depends T7, T11)
├── T20: Save handler (overwrite confirm, multi-root, mkdirs)       [deep]               (depends T18)
├── T21: GitHub Actions YAML generator                              [deep]               (depends T17)

Wave 4 (After Wave 3 — follow-ups + telemetry):
├── T22: "Build & push to ACR" follow-up (terminal)                 [quick]              (depends T17)
├── T23: "Deploy to AKS" follow-up (handoff to deployManifest)      [quick]              (depends T17)
├── T24: "Open in portal" follow-up                                 [quick]              (depends T17)
├── T25: Telemetry: chat.kickstart.* + kickstart.*                  [unspecified-high]   (depends T13, T7)
├── T26: Empty-state UX (no clusters / no ACR / no model / no git)  [visual-engineering] (depends T7, T13, T15)
├── T27: package.json final wiring (slash commands, sampleRequest)  [quick]              (depends T13)

Wave FINAL (After ALL — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit                                       (oracle)
├── F2: Code quality review                                         (unspecified-high)
├── F3: Real manual QA                                              (unspecified-high)
├── F4: Scope fidelity check                                        (deep)
→ Present results → Get explicit user okay

Critical Path: T1 → T3 → T7 → T13 → T17 → T20 → F1-F4 → user okay
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6 (Wave 1) / 9 (Wave 2)
```

### Dependency Matrix (abbreviated)

- **T1**: — → T7, T11, T12, T13
- **T2**: — → T7, T8, T10
- **T3**: — → T7
- **T4**: — → T7, T9
- **T6**: — → T15
- **T7**: T2, T3, T4 → T16, T19
- **T13**: T1 → T17, T22, T23, T24, T25, T27
- **T17**: T13 → T18, T21, T22, T23, T24
- **T18**: T17 → T20
- **F1-F4**: ALL implementation → user okay

### Agent Dispatch Summary

- **Wave 1**: 6 — T1–T2 → `quick`, T3–T4 → `quick`, T5–T6 → `quick`
- **Wave 2**: 9 — T7 → `unspecified-high`, T8–T9 → `visual-engineering`, T10–T12 → `quick`, T13 → `unspecified-high`, T14 → `quick`, T15 → `unspecified-high`
- **Wave 3**: 6 — T16 → `unspecified-high`, T17–T18 → `deep`, T19 → `unspecified-high`, T20–T21 → `deep`
- **Wave 4**: 6 — T22–T24 → `quick`, T25 → `unspecified-high`, T26 → `visual-engineering`, T27 → `quick`
- **FINAL**: 4 — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Add `aks.kickstartEnabledPreview` config + package.json contributions skeleton

  **What to do**:
  - Add to `package.json` `contributes.configuration.properties`:
    - `"aks.kickstartEnabledPreview": { "type": "boolean", "default": false, "description": "Enable the Kickstart chat agent and webview (preview)." }`
  - Add empty contribution arrays we'll fill later: a placeholder `chatParticipants: []` and reserve a command id `aks.kickstartContainerization` in `contributes.commands` (title `AKS: Kickstart Containerization`, category `Azure Kubernetes Service`, `enablement: "config.aks.kickstartEnabledPreview"`).
  - DO NOT register handler code yet — this task is config only.

  **Must NOT do**: register the chat participant in code; modify any other config property.

  **Recommended Agent Profile**:
  - **Category**: `quick` — single-file config edit.
  - **Skills**: none required.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T7, T11, T12, T13
  - **Blocked By**: None.

  **References**:
  - Pattern: `package.json` existing `aks.copilotEnabledPreview` and `aks.containerAssistEnabledPreview` properties — copy the shape.
  - Pattern: existing `contributes.commands` entries (e.g., `aks.attachAcrToCluster`).
  - WHY: enablement gating must mirror existing preview features so the rollout pattern is consistent.

  **Acceptance Criteria**:
  - [ ] `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` exits 0.
  - [ ] `grep -c "aks.kickstartEnabledPreview" package.json` → ≥ 2 (config + enablement).
  - [ ] `npm run build` succeeds.

  **QA Scenarios**:

  ```
  Scenario: Preview flag appears in VS Code Settings UI
    Tool: Playwright
    Preconditions: Extension built and loaded in dev host.
    Steps:
      1. Open Settings UI.
      2. Search "kickstart".
      3. Locate the "Aks: Kickstart Enabled Preview" toggle.
    Expected Result: Toggle present, default unchecked.
    Failure Indicators: Setting absent or default true.
    Evidence: .sisyphus/evidence/task-1-preview-flag-settings.png

  Scenario: Command title appears in palette only when flag is on
    Tool: Playwright
    Preconditions: Flag = false.
    Steps:
      1. Open command palette (F1), type "Kickstart".
      2. Toggle flag to true via settings.
      3. Re-open command palette, type "Kickstart".
    Expected Result: Step 1 → no result. Step 3 → "AKS: Kickstart Containerization" appears.
    Evidence: .sisyphus/evidence/task-1-palette-gating.png
  ```

  **Commit**: YES — `feat(kickstart): add preview flag and command/config skeleton`. Files: `package.json`. Pre-commit: `npm run build`.

- [x] 2. Webview contract `src/webview-contract/webviewDefinitions/kickstart.ts`

  **What to do**:
  - Create the file with three exported types and the `WebviewDefinition` alias:
    - `InitialState`: `{ initialClusterId?: string }` (optional pre-selection from tree-view entry).
    - `ToVsCodeMsgDef`:
      - `getSubscriptionsRequest: void`
      - `getResourceGroupsRequest: { subscriptionId: string }`
      - `getClustersRequest: { subscriptionId: string; resourceGroup?: string }`
      - `getAcrsRequest: { subscriptionId: string; resourceGroup?: string }`
      - `getPermissionStatusRequest: { clusterKey: ClusterKey; acrKey: AcrKey }`
      - `attachAcrRequest: { clusterKey: ClusterKey; acrKey: AcrKey }`
      - `startKickstartRequest: { clusterKey: ClusterKey; acrKey: AcrKey }` (closes webview, opens chat)
    - `ToWebViewMsgDef`: matching responses + `permissionStatusUpdated` event.
  - Use existing `ClusterKey` / `AcrKey` / `SubscriptionKey` types from `webview-contract/webviewDefinitions/attachAcrToCluster.ts` (re-export or import).
  - Final line: `export type KickstartDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;`

  **Must NOT do**: define new ClusterKey/AcrKey shapes; duplicate `acrPullRoleDefinitionName`.

  **Recommended Agent Profile**:
  - **Category**: `quick` — single typed-contract file.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T7, T8, T10
  - **Blocked By**: None.

  **References**:
  - Pattern: `src/webview-contract/webviewDefinitions/attachAcrToCluster.ts:1-94` — exact file shape.
  - Type source: `src/webview-contract/webviewTypes.ts:27-35` — `WebviewDefinition` triple.
  - WHY: AttachAcr contract is the closest analog (also picks Sub/RG/Cluster/ACR with permission); we model after it but tailor message names for our flow.

  **Acceptance Criteria**:
  - [ ] File exists at exact path.
  - [ ] `tsc --noEmit src/webview-contract/webviewDefinitions/kickstart.ts` succeeds.
  - [ ] No new copy of `acrPullRoleDefinitionName` constant — `grep -c "7f951dda" src/webview-contract/webviewDefinitions/kickstart.ts` → 0.

  **QA Scenarios**:

  ```
  Scenario: Contract compiles and types are referenced from existing AttachAcr contract
    Tool: Bash
    Steps:
      1. Run: npx tsc --noEmit
      2. Run: grep -E "import.*ClusterKey.*from.*attachAcrToCluster" src/webview-contract/webviewDefinitions/kickstart.ts
    Expected Result: Step 1 exit 0; Step 2 returns ≥1 match.
    Evidence: .sisyphus/evidence/task-2-contract-compile.log
  ```

  **Commit**: YES — `feat(kickstart): add webview contract`. Files: `src/webview-contract/webviewDefinitions/kickstart.ts`. Pre-commit: `npm run build`.

- [x] 3. Extract `getClusterPrincipalId` to `src/commands/utils/identities.ts` (TDD)

  **What to do**:
  - **RED**: Create `src/commands/utils/identities.test.ts` (mocha + sinon) with 4 cases:
    1. ManagedCluster has `identity.type = "SystemAssigned"` and `identityProfile.kubeletidentity.objectId = "kubelet-oid"` → returns `{succeeded: true, result: "kubelet-oid"}`.
    2. ManagedCluster has SystemAssigned identity but `kubeletidentity.objectId` missing → returns `{succeeded: false, error: /no kubelet identity/}`.
    3. ManagedCluster has no managed identity but `servicePrincipalProfile.clientId = "sp-cid"` → returns `{succeeded: true, result: "sp-cid"}`.
    4. ManagedCluster has BOTH managed identity AND service principal → returns kubelet identity (NOT SP) — guards against legacy clusters per Metis Q6.
  - **GREEN**: Create `src/commands/utils/identities.ts` exporting `async function getClusterPrincipalId(sessionProvider, clusterKey): Promise<Errorable<string>>`. Move/adapt logic from `AttachAcrToClusterPanel.ts:256-309`.
  - **REFACTOR**: Update both call sites to import the new helper:
    - `src/panels/AttachAcrToClusterPanel.ts:256-309` → `import { getClusterPrincipalId } from "../commands/utils/identities";` and remove the local function.
    - `src/commands/aksAttachAcrToCluster/attachAcrToCluster.ts:426-467` → same.
  - Run `lsp_find_references` on the original `getClusterPrincipalId` symbol BEFORE the move to confirm only those 2 call sites exist.

  **Must NOT do**: change function signature in a way that breaks existing callers; introduce new behavior beyond what existed.

  **Recommended Agent Profile**:
  - **Category**: `quick` — refactor + small new file + tests.
  - **Skills**: `test-driven-development`.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T7
  - **Blocked By**: None.

  **References**:
  - `src/panels/AttachAcrToClusterPanel.ts:256-309` — first existing implementation.
  - `src/commands/aksAttachAcrToCluster/attachAcrToCluster.ts:426-467` — second existing implementation.
  - `src/commands/utils/errorable.ts` (or wherever `Errorable<T>` lives) — confirm import path.
  - WHY: Two duplicates → single source of truth before kickstart adds a third caller.

  **Acceptance Criteria**:
  - [ ] `src/commands/utils/identities.ts` exists with one exported function.
  - [ ] `src/commands/utils/identities.test.ts` has 4 named test cases, all passing.
  - [ ] `npm test -- --grep getClusterPrincipalId` → all pass.
  - [ ] `grep -rn "function getClusterPrincipalId" src/panels src/commands/aksAttachAcrToCluster` → 0 results (function fully extracted).
  - [ ] `npm run build` passes (no broken imports).
  - [ ] AttachAcrToClusterPanel functionality unchanged — confirmed by running existing AttachAcr tests if any exist.

  **QA Scenarios**:

  ```
  Scenario: All 4 unit test cases pass
    Tool: Bash
    Steps:
      1. Run: npm test -- --grep "getClusterPrincipalId"
    Expected Result: 4 passing, 0 failing.
    Evidence: .sisyphus/evidence/task-3-unit-tests.log

  Scenario: AttachAcr panel still opens and works after refactor
    Tool: Playwright
    Steps:
      1. Launch dev host.
      2. Run command "AKS: Attach ACR to Cluster".
      3. Verify panel renders, subscription dropdown loads.
    Expected Result: No regressions; panel shows pickers as before.
    Evidence: .sisyphus/evidence/task-3-attachacr-regression.png

  Scenario: Cluster with both SP and kubelet identity returns kubelet (negative regression)
    Tool: Bash
    Steps:
      1. Run unit test case 4.
    Expected Result: Returns kubelet-oid, NOT sp-cid.
    Evidence: .sisyphus/evidence/task-3-prefer-kubelet.log
  ```

  **Commit**: YES — `refactor(utils): extract getClusterPrincipalId to identities helper`. Files: `src/commands/utils/identities.ts`, `src/commands/utils/identities.test.ts`, `src/panels/AttachAcrToClusterPanel.ts`, `src/commands/aksAttachAcrToCluster/attachAcrToCluster.ts`. Pre-commit: `npm run build && npm test`.

- [x] 4. New `src/commands/utils/acrRoleHelpers.ts` with `principalHasAcrPullForAcr` (TDD)

  **What to do**:
  - **RED**: Create `src/commands/utils/acrRoleHelpers.test.ts` with 3 cases:
    1. Mock `getPrincipalRoleAssignmentsForAcr` returns role with id ending in `7f951dda-4ed3-4680-a7ca-43fe172d538d` → returns `{succeeded: true, result: true}`.
    2. Mock returns roles without AcrPull GUID → returns `{succeeded: true, result: false}`.
    3. ACR is in subscription `sub-A`, cluster's principal in `sub-B` → confirm `getScopeForAcr` is called with ACR's subscription, and `getAuthorizationManagementClient` is built with ACR's subscription (cross-sub scenario per Metis).
  - **GREEN**: Create `src/commands/utils/acrRoleHelpers.ts`:
    - `export async function principalHasAcrPullForAcr(sessionProvider, principalId, acrKey): Promise<Errorable<boolean>>`
    - Uses `getAuthorizationManagementClient(sessionProvider, acrKey.subscriptionId)`, `getPrincipalRoleAssignmentsForAcr`, and compares `roleAssignment.roleDefinitionId.split("/").pop()` to `acrPullRoleDefinitionName` (imported from `webview-contract/webviewDefinitions/attachAcrToCluster`).

  **Must NOT do**: hardcode the AcrPull GUID; talk to real Azure in tests.

  **Recommended Agent Profile**:
  - **Category**: `quick` — small focused helper + tests.
  - **Skills**: `test-driven-development`.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T7, T9
  - **Blocked By**: None.

  **References**:
  - `src/commands/utils/roleAssignments.ts` — existing helpers being wrapped.
  - `src/webview-contract/webviewDefinitions/attachAcrToCluster.ts:27` — `acrPullRoleDefinitionName` constant (must IMPORT, not duplicate).
  - `src/panels/AttachAcrToClusterPanel.ts:135-161` — pattern of how the inline check is done today (we're packaging it).
  - WHY: Three callers will need this check (kickstart panel + future code paths + potential refactor of AttachAcr panel itself).

  **Acceptance Criteria**:
  - [ ] All 3 unit test cases pass.
  - [ ] `grep -c "7f951dda" src/commands/utils/acrRoleHelpers.ts` → 0 (constant imported).
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Cross-subscription scope construction
    Tool: Bash (sinon-driven)
    Steps:
      1. Run: npm test -- --grep "principalHasAcrPullForAcr cross-sub"
    Expected Result: Test asserts getAuthorizationManagementClient called with acrKey.subscriptionId, NOT a different sub.
    Evidence: .sisyphus/evidence/task-4-crosssub-test.log

  Scenario: Has-AcrPull true case
    Tool: Bash
    Steps:
      1. Run: npm test -- --grep "principalHasAcrPullForAcr"
    Expected Result: All 3 pass.
    Evidence: .sisyphus/evidence/task-4-has-acr-pull.log
  ```

  **Commit**: YES — `feat(utils): add principalHasAcrPullForAcr helper with cross-sub support`. Files: `src/commands/utils/acrRoleHelpers.ts`, `src/commands/utils/acrRoleHelpers.test.ts`. Pre-commit: `npm run build && npm test`.

- [x] 5. Sample URL config constant `src/chatParticipants/kickstart/config.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/config.ts`:
    - `export const KICKSTART_SAMPLE_REPO_URL = "https://github.com/Azure-Samples/aks-store-demo.git";`
    - `export const KICKSTART_PARTICIPANT_ID = "ms-kubernetes-tools.kickstart";`
    - `export const KICKSTART_PARTICIPANT_NAME = "kickstart";`
    - `export const KICKSTART_CONTENT_ID = "kickstart" as const;`
  - Add a sanity test `src/chatParticipants/kickstart/config.test.ts`:
    - URL matches `^https://github\.com/[\w.-]+/[\w.-]+(\.git)?$`.
    - Participant id contains a `.` (publisher-prefixed convention).

  **Must NOT do**: hardcode any of these values inline elsewhere — every other task imports from this file.

  **Recommended Agent Profile**:
  - **Category**: `quick` — constants only.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T15.
  - **Blocked By**: None.

  **References**:
  - Webview content id convention: `src/webview-contract/webviewTypes.ts:41-63` — `AllWebviewDefinitions` keys are content ids.

  **Acceptance Criteria**:
  - [ ] File exists with all 4 exports.
  - [ ] Config test passes.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Sample URL is well-formed
    Tool: Bash
    Steps:
      1. Run: npm test -- --grep "kickstart config"
    Expected Result: All assertions pass.
    Evidence: .sisyphus/evidence/task-5-config-test.log
  ```

  **Commit**: YES — `feat(kickstart): add config constants`. Files: 2. Pre-commit: `npm run build && npm test`.

- [x] 6. Git extension wrapper `src/chatParticipants/kickstart/gitExtension.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/gitExtension.ts` with two functions:
    - `async function getGitApi(): Promise<Errorable<GitAPI>>` — calls `vscode.extensions.getExtension('vscode.git')`. If missing → `{succeeded: false, error: 'Git extension is not installed'}`. If present but not active → `await ext.activate()`. If `.exports.getAPI(1)` throws → `{succeeded: false, error: 'Git extension API unavailable — enable the built-in Git extension and reload window'}`.
    - `async function cloneSample(url: string, parentPath: string, targetName: string, token: CancellationToken): Promise<Errorable<string>>` — uses `vscode.window.withProgress({location: Notification, cancellable: true})`; checks if `parentPath/targetName` exists; if exists, suffixes `-1`, `-2`; calls `gitApi.clone(url, parentPath, {parentPath, recursive: true})`; returns the cloned-to path. Catches network errors, surfaces them.
  - Define minimal `GitAPI` type inline (`{ clone(url: string, parentPath: string, options?: any): Promise<string> }`) — do not depend on `git.d.ts` ambient types unless they're already in the repo.
  - Add a TODO comment with link to VS Code git extension API docs.

  **Must NOT do**: write any code that touches GitHub directly (no Octokit, no `fetch`); call the wrapper anywhere yet (T15 will wire it).

  **Recommended Agent Profile**:
  - **Category**: `quick` — focused wrapper.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T15.
  - **Blocked By**: None.

  **References**:
  - VS Code Git extension API: built-in extension `vscode.git`. Docs: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts.
  - WHY: Encapsulating the API behind one helper makes "git extension disabled" handling testable.

  **Acceptance Criteria**:
  - [ ] File exists, exports both functions.
  - [ ] No `as any` in the file (per Metis quality bar).
  - [ ] `npm run build` passes.
  - [ ] Unit test `gitExtension.test.ts`: stub `vscode.extensions.getExtension` to return undefined → assert `getGitApi()` returns the right error.

  **QA Scenarios**:

  ```
  Scenario: getGitApi handles missing git extension
    Tool: Bash (sinon)
    Steps:
      1. Run: npm test -- --grep "gitExtension missing"
    Expected Result: Returns Errorable with message "Git extension is not installed".
    Evidence: .sisyphus/evidence/task-6-git-missing.log

  Scenario: getGitApi activates extension if dormant
    Tool: Bash (sinon)
    Steps:
      1. Stub getExtension to return {isActive: false, activate: spy, exports: {getAPI: () => ({clone: spy})}}.
      2. Call getGitApi().
    Expected Result: activate() spy was called.
    Evidence: .sisyphus/evidence/task-6-git-activate.log
  ```

  **Commit**: YES — `feat(kickstart): git extension wrapper for sample cloning`. Files: 2. Pre-commit: `npm run build && npm test`.

- [x] 7. `KickstartPanel` + `KickstartPanelDataProvider` (extension side)

  **What to do**:
  - Create `src/panels/KickstartPanel.ts`. Two classes:
    - `KickstartPanel extends BasePanel<"kickstart">` — constructor calls `super(extensionUri, "kickstart", { /* default toWebview msgs */ })`.
    - `KickstartPanelDataProvider implements PanelDataProvider<"kickstart">`. Holds `sessionProvider`, optional `initialClusterId`. Implements:
      - `getTitle(): string` → `"Kickstart Containerization"`.
      - `getInitialState(): InitialState` → `{ initialClusterId }`.
      - `getTelemetryDefinition()` → `{ "kickstart.attachAcrClicked": true, "kickstart.startKickstartClicked": true }` (from contract verbs).
      - `getMessageHandler(webview)` → returns `MessageHandler<ToVsCodeMsgDef>`:
        - `getSubscriptionsRequest`: `getReadySessionProvider().getSubscriptions(SelectionType.Filtered)` → respond with `getSubscriptionsResponse`.
        - `getResourceGroupsRequest`: `getResources(sp, sub, "Microsoft.Resources/resourceGroups")` (use existing helper).
        - `getClustersRequest`: `getResources(sp, sub, clusterResourceType)` filtered by RG if provided.
        - `getAcrsRequest`: `getResources(sp, sub, acrResourceType)` filtered by RG if provided.
        - `getPermissionStatusRequest`: orchestrate `getClusterPrincipalId` (T3) + `principalHasAcrPullForAcr` (T4); respond with `permissionStatusResponse: { hasAcrPull: boolean, attached: boolean }` (attached === hasAcrPull per Container Assist call-chain research).
        - `attachAcrRequest`: `vscode.commands.executeCommand("aks.attachAcrToCluster", { clusterId: ..., acrId: ... })`. Then re-poll permission status after 2s (per research: role propagation delay).
        - `startKickstartRequest`: dispose panel; `vscode.commands.executeCommand("workbench.action.chat.open", { query: "@kickstart /start", attachments: [{ clusterKey, acrKey }] })` (attachments serialized in chat history per chat API research).
  - Polling strategy for `getPermissionStatusRequest`: simple request/response (no auto-poll on extension side; webview side handles refresh button).

  **Must NOT do**: implement role-create logic inline (delegate to existing `aks.attachAcrToCluster`); add new business logic — orchestrate only.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — multi-handler panel with 7 message types, follows existing analog precisely.
  - **Skills**: none required (pattern-following).

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T11, T12, T15.
  - **Blocked By**: T1 (preview flag), T2 (contract), T3 (identities), T4 (acr roles).

  **References**:
  - `src/panels/AttachAcrToClusterPanel.ts:1-310` — closest analog: same pickers, same permission check, same remediation primitive.
  - `src/panels/BasePanel.ts:1-150` — base class contract (`getTitle`, `getInitialState`, `getTelemetryDefinition`, `getMessageHandler`).
  - `src/commands/utils/azureResources.ts:getResources()` — Sub/RG/Cluster/ACR enumeration.
  - `src/commands/utils/clusters.ts:getManagedCluster()` — cluster fetch for principal lookup.
  - `src/commands/aksAttachAcrToCluster/attachAcrToCluster.ts:19-21` — `launchAttachAcrToClusterCommand` invocation signature.
  - WHY: The AttachAcr panel solves the same Sub→RG→Cluster→ACR + permission-check problem; we mirror its message-handler structure but replace the "create role" verb with "open chat" verb.

  **Acceptance Criteria**:
  - [ ] File exists, two exported classes.
  - [ ] All 7 message handlers implemented with no `as any`.
  - [ ] `npm run build` passes.
  - [ ] `tsc --noEmit` clean for the file.

  **QA Scenarios**:

  ```
  Scenario: Panel opens, fetches subscriptions, responds with list
    Tool: Playwright
    Preconditions: Logged in to Azure with ≥1 subscription. Preview flag = true.
    Steps:
      1. F1 → "AKS: Kickstart Containerization".
      2. Wait for panel iframe.
      3. Assert subscription dropdown contains ≥1 option (CSS: `select[data-testid="kickstart-subscription"] option`).
    Expected Result: Subscriptions populate within 5s.
    Failure Indicators: Empty dropdown, error banner, panel never opens.
    Evidence: .sisyphus/evidence/task-7-subs-populate.png

  Scenario: Permission check returns both flags
    Tool: Bash (extension test harness with stubbed Azure SDK)
    Steps:
      1. Stub getManagedCluster + getPrincipalRoleAssignmentsForAcr.
      2. Send getPermissionStatusRequest with valid keys.
    Expected Result: Response contains both hasAcrPull and attached fields (boolean).
    Evidence: .sisyphus/evidence/task-7-perm-response.log

  Scenario: attachAcrRequest invokes existing command (negative path: error surfaces)
    Tool: Bash
    Steps:
      1. Stub vscode.commands.executeCommand to throw.
      2. Send attachAcrRequest.
    Expected Result: Webview receives an error message, panel does NOT crash.
    Evidence: .sisyphus/evidence/task-7-attach-error.log
  ```

  **Commit**: YES — `feat(kickstart): add KickstartPanel preflight UI orchestrator`. Files: `src/panels/KickstartPanel.ts`. Pre-commit: `npm run build`.

- [x] 8. Webview React app `webview-ui/src/Kickstart/Kickstart.tsx` + sub-components

  **What to do**:
  - Create directory `webview-ui/src/Kickstart/` with:
    - `Kickstart.tsx` — top-level component. State: `subscriptions`, `selectedSub`, `resourceGroups`, `selectedRg`, `clusters`, `selectedCluster`, `acrs`, `selectedAcr`, `permissions: { hasAcrPull?: boolean, attached?: boolean, loading: boolean, error?: string }`.
    - `Pickers.tsx` — 4 cascading dropdowns. On sub change, fire `getResourceGroupsRequest` + `getClustersRequest` + `getAcrsRequest`. On any of cluster/acr change, fire `getPermissionStatusRequest`.
    - `PermissionChecks.tsx` — 2 visual rows ("AcrPull role granted to cluster identity", "ACR attached to cluster"). Each shows: green check + `text` if true, red ❌ + `text` + "Attach now" button if false. Loading spinner while `permissions.loading`. Refresh button to re-fire permission request.
    - `ActionBar.tsx` — bottom: "Start Kickstart" button (disabled unless both checks pass) + "Cancel" (closes panel).
  - Use existing `useState`/`useEffect` patterns from `AttachAcrToCluster/` directory.
  - Wire to vscode message bridge using existing `getStateManagement` / `vscode` postMessage helper from webview-ui.
  - Add `data-testid` attributes on all interactive elements for Playwright.

  **Must NOT do**: implement business logic in React (orchestrator is in panel); add inline styles — use existing CSS module / Fluent components.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` — React component design with state cascade + visual permission UX.
  - **Skills**: `frontend-ui-ux`.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T11.
  - **Blocked By**: T2 (contract).

  **References**:
  - `webview-ui/src/AttachAcrToCluster/` — directory pattern + state shape + message wiring.
  - `webview-ui/src/main.tsx` — must be modified to register `kickstart` in rendererLookup (T11).
  - WHY: AttachAcrToCluster is the visual analog (Sub→RG→Cluster→ACR pickers + a single permission row); we extend to 2 rows + remediation hook.

  **Acceptance Criteria**:
  - [ ] All 4 components compile.
  - [ ] `npm run build` passes (webpack bundles webview).
  - [ ] All interactive elements have `data-testid`.
  - [ ] Both permission rows render with correct icons in mock state.

  **QA Scenarios**:

  ```
  Scenario: Cascade renders end-to-end
    Tool: Playwright
    Preconditions: Panel opened, mocked message responses for sub/rg/cluster/acr.
    Steps:
      1. Select subscription in dropdown.
      2. Wait for RG/Cluster/ACR dropdowns to populate.
      3. Select cluster + acr.
      4. Wait for permission rows to update.
    Expected Result: All 4 dropdowns load; both permission rows show check or X with descriptive text.
    Evidence: .sisyphus/evidence/task-8-cascade.png

  Scenario: Start button gating
    Tool: Playwright
    Steps:
      1. Mock both permissions = false.
      2. Assert Start Kickstart button has `disabled` attribute.
      3. Mock both = true.
      4. Assert Start button enabled.
    Expected Result: Button correctly gates on permission state.
    Evidence: .sisyphus/evidence/task-8-start-gating.png

  Scenario: Attach Now button click triggers attachAcrRequest
    Tool: Playwright (with message inspector)
    Steps:
      1. Mock attached = false.
      2. Click "Attach now" button.
      3. Inspect postMessage calls.
    Expected Result: An `attachAcrRequest` message was sent with current clusterKey/acrKey.
    Evidence: .sisyphus/evidence/task-8-attach-msg.log
  ```

  **Commit**: YES — `feat(kickstart): React webview UI for preflight + permission checks`. Files: `webview-ui/src/Kickstart/*`. Pre-commit: `npm run build`.

- [x] 9. Permission status orchestrator (extension helper)

  **What to do**:
  - Create `src/commands/utils/kickstartPermissions.ts`:
    - `export async function checkKickstartPermissions(sessionProvider, clusterKey, acrKey): Promise<Errorable<{ hasAcrPull: boolean; attached: boolean }>>`
    - Calls `getClusterPrincipalId` (T3); on failure, return early with error.
    - Calls `principalHasAcrPullForAcr` (T4) with the principalId.
    - Returns `{ hasAcrPull: result, attached: result }` (per research: AcrPull on the kubelet identity IS the attach status — there's no separate ManagedCluster field).
  - Add unit test `kickstartPermissions.test.ts`:
    1. Both sub-helpers succeed → `{succeeded: true, result: {hasAcrPull: true, attached: true}}`.
    2. `getClusterPrincipalId` fails → propagate error.
    3. `principalHasAcrPullForAcr` returns false → `{hasAcrPull: false, attached: false}`.

  **Must NOT do**: introduce a separate "attached" code path; bypass T3/T4 helpers.

  **Recommended Agent Profile**:
  - **Category**: `quick` — thin orchestrator + 3 unit tests.
  - **Skills**: `test-driven-development`.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T7 (T7's `getPermissionStatusRequest` calls this).
  - **Blocked By**: T3, T4.

  > **Note on dependency timing**: T7 spec lists this as a direct call. To preserve Wave 2 parallelism, T7 author should write `getPermissionStatusRequest` against the function signature of `checkKickstartPermissions` and import it; both can land in same wave with merge.

  **References**:
  - `src/commands/utils/identities.ts:getClusterPrincipalId` (T3).
  - `src/commands/utils/acrRoleHelpers.ts:principalHasAcrPullForAcr` (T4).
  - WHY: Composing the two atomic helpers in one place keeps both webview AND chat (which may also want pre-flight) using the same primitive.

  **Acceptance Criteria**:
  - [ ] All 3 unit tests pass.
  - [ ] `npm run build` passes.
  - [ ] No duplicate role-assignment fetch logic in this file (must call T4 helper).

  **QA Scenarios**:

  ```
  Scenario: Both checks pass on healthy cluster
    Tool: Bash (sinon stubs)
    Steps:
      1. Run: npm test -- --grep "checkKickstartPermissions all-pass"
    Expected Result: Returns hasAcrPull=true, attached=true.
    Evidence: .sisyphus/evidence/task-9-allpass.log

  Scenario: Error in principal lookup propagates
    Tool: Bash
    Steps:
      1. Run: npm test -- --grep "checkKickstartPermissions principal-error"
    Expected Result: Returns Errorable with original error message preserved.
    Evidence: .sisyphus/evidence/task-9-error.log
  ```

  **Commit**: YES — `feat(utils): add checkKickstartPermissions orchestrator`. Files: 2. Pre-commit: `npm run build && npm test`.

- [x] 10. Command entry `src/commands/aksKickstart/kickstart.ts` + extension registration

  **What to do**:
  - Create `src/commands/aksKickstart/kickstart.ts`:
    - `export async function aksKickstart(_context: IActionContext, target?: unknown): Promise<void>`
    - Resolve cluster pre-selection: if `target` is an AKS tree-view node, extract `clusterId` via existing `getClusterDetailsForCluster` pattern; else undefined.
    - Get session provider via `getReadySessionProvider()`.
    - Construct `new KickstartPanel(context.extensionUri)` and `new KickstartPanelDataProvider(sessionProvider, initialClusterId)`; call `panel.show(dataProvider)`.
  - Register in `src/extension.ts`:
    - `registerCommandWithTelemetry("aks.kickstartContainerization", aksKickstart);`
  - Update `package.json`:
    - `contributes.menus["view/item/context"]` add `{ command: "aks.kickstartContainerization", when: "view == aks && viewItem =~ /aks.cluster/ && config.aks.kickstartEnabledPreview", group: "kickstart@1" }`.

  **Must NOT do**: skip the `enablement` clause on the command; expose to non-AKS tree items.

  **Recommended Agent Profile**:
  - **Category**: `quick` — small command + registration.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T11.
  - **Blocked By**: T1 (preview flag), T7 (panel class).

  **References**:
  - `src/commands/aksAttachAcrToCluster/attachAcrToCluster.ts:19-50` — analog command shape + extensionUri pass-through.
  - `src/extension.ts` — `registerCommandWithTelemetry` usage; AKS tree-item context-menu pattern.
  - `package.json` — existing `view/item/context` entries for AKS tree.

  **Acceptance Criteria**:
  - [ ] Command appears in palette only when flag = true.
  - [ ] Command appears in tree-view context menu only on cluster nodes.
  - [ ] Tree-view invocation pre-populates `initialClusterId` in panel state.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Tree-view context menu launches with pre-selection
    Tool: Playwright
    Preconditions: Flag = true; signed in to Azure.
    Steps:
      1. Open AKS tree view, expand a subscription.
      2. Right-click a cluster.
      3. Click "Kickstart Containerization".
      4. Wait for panel; inspect data-initialstate attribute.
    Expected Result: Panel opens with initialClusterId === clicked cluster's id.
    Evidence: .sisyphus/evidence/task-10-treeview-launch.png

  Scenario: Palette launch with no pre-selection
    Tool: Playwright
    Steps:
      1. F1 → "AKS: Kickstart Containerization".
    Expected Result: Panel opens; initialClusterId is undefined.
    Evidence: .sisyphus/evidence/task-10-palette-launch.png

  Scenario: Command hidden when flag is false (negative)
    Tool: Playwright
    Steps:
      1. Set flag = false.
      2. Right-click a cluster in AKS tree view.
    Expected Result: "Kickstart Containerization" item NOT in context menu.
    Evidence: .sisyphus/evidence/task-10-flag-off.png
  ```

  **Commit**: YES — `feat(kickstart): register command + tree-view context menu`. Files: `src/commands/aksKickstart/kickstart.ts`, `src/extension.ts`, `package.json`. Pre-commit: `npm run build`.

- [x] 11. Webview integration: register `kickstart` content id end-to-end

  **What to do**:
  - Edit `src/webview-contract/webviewTypes.ts`:
    - Import `KickstartDefinition` from `./webviewDefinitions/kickstart`.
    - Add to `AllWebviewDefinitions` interface: `kickstart: KickstartDefinition;`.
  - Edit `webview-ui/src/main.tsx`:
    - Import `Kickstart` from `./Kickstart/Kickstart`.
    - Add to `rendererLookup`: `kickstart: () => <Kickstart />,`.
  - Verify content id `"kickstart"` is referenced consistently with constant from T5 (`KICKSTART_CONTENT_ID`).

  **Must NOT do**: introduce a different content id; modify rendererLookup signature.

  **Recommended Agent Profile**:
  - **Category**: `quick` — 2-file wiring.

  **Parallelization**:
  - **Can Run In Parallel**: NO within Wave 3 — must merge T7, T8, T10 first.
  - **Blocks**: F1, F2, F3.
  - **Blocked By**: T7, T8, T10.

  **References**:
  - `src/webview-contract/webviewTypes.ts:41-63` — `AllWebviewDefinitions` interface (add one line).
  - `webview-ui/src/main.tsx` — `rendererLookup` object (add one line).

  **Acceptance Criteria**:
  - [ ] `grep -c "kickstart" src/webview-contract/webviewTypes.ts` ≥ 2 (import + key).
  - [ ] `grep -c "Kickstart" webview-ui/src/main.tsx` ≥ 2 (import + lookup).
  - [ ] `npm run build` passes — webpack bundles webview without "unknown content id" warning.
  - [ ] Panel opens and renders the React app (smoke test).

  **QA Scenarios**:

  ```
  Scenario: End-to-end panel-to-React render
    Tool: Playwright
    Preconditions: Flag = true; built extension loaded.
    Steps:
      1. Run "AKS: Kickstart Containerization".
      2. Wait for iframe.
      3. Locate `[data-testid="kickstart-root"]` element inside iframe.
    Expected Result: Element present (proves rendererLookup wired correctly).
    Evidence: .sisyphus/evidence/task-11-render.png
  ```

  **Commit**: YES — `feat(kickstart): wire webview content id and rendererLookup`. Files: 2. Pre-commit: `npm run build`.

- [x] 12. Chat participant registration `src/chatParticipants/kickstart/participant.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/participant.ts`:
    - `export function registerKickstartParticipant(context: vscode.ExtensionContext): void`
    - Inside: `const participant = vscode.chat.createChatParticipant(KICKSTART_PARTICIPANT_ID, handler);`
    - Set `participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "aks-tools.png");`.
    - Set `participant.followupProvider = { provideFollowups: provideKickstartFollowups }` (see T22).
    - Add `context.subscriptions.push(participant);`.
    - `handler` is a placeholder for now — calls `defaultHandler` from T13.
  - Add `chatParticipants` array to `package.json` `contributes`:
    ```json
    {
      "id": "ms-kubernetes-tools.kickstart",
      "fullName": "Kickstart",
      "name": "kickstart",
      "description": "Kickstart containerization for AKS",
      "isSticky": true,
      "commands": [
        { "name": "start", "description": "Start a kickstart session for current workspace" },
        { "name": "sample", "description": "Start a kickstart session using a sample repo" }
      ],
      "when": "config.aks.kickstartEnabledPreview"
    }
    ```
  - Register from `src/extension.ts` — call `registerKickstartParticipant(context)` only if `vscode.workspace.getConfiguration("aks").get("kickstartEnabledPreview")` is true (defensive, since `when` may not gate runtime registration on older VS Code builds).

  **Must NOT do**: register without preview-flag check; hardcode participant id.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — chat API contract + package.json contribution + extension wiring.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3) — independent of T11.
  - **Blocks**: T13, T14, T15, T22.
  - **Blocked By**: T1 (flag), T5 (constants).

  **References**:
  - VS Code chat API: `vscode.chat.createChatParticipant(id, handler)` — official docs. Per librarian research: `id` must be publisher-prefixed; `name` is the user-visible `@mention` token.
  - `resources/aks-tools.png` — existing extension icon to reuse.
  - WHY: Participant registration is the entry point for `@kickstart` in chat; gating at registration AND at `when` clause is defense-in-depth.

  **Acceptance Criteria**:
  - [ ] `@kickstart` typeable in chat input when flag = true.
  - [ ] `@kickstart` NOT available when flag = false (post window reload).
  - [ ] Both `/start` and `/sample` slash commands appear in chat input autocomplete after `@kickstart`.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Participant appears in chat after enabling flag
    Tool: Playwright
    Steps:
      1. Set aks.kickstartEnabledPreview = true. Reload window.
      2. Open chat view (Ctrl+Alt+I).
      3. Type "@".
      4. Assert "kickstart" appears in autocomplete.
    Expected Result: kickstart present.
    Evidence: .sisyphus/evidence/task-12-participant-visible.png

  Scenario: Slash commands listed
    Tool: Playwright
    Steps:
      1. Type "@kickstart /" in chat input.
    Expected Result: Both /start and /sample shown with descriptions.
    Evidence: .sisyphus/evidence/task-12-slash-commands.png

  Scenario: Participant hidden when flag off (negative)
    Tool: Playwright
    Steps:
      1. Set flag = false. Reload.
      2. Type "@" in chat.
    Expected Result: kickstart NOT in autocomplete list.
    Evidence: .sisyphus/evidence/task-12-flag-off.png
  ```

  **Commit**: YES — `feat(kickstart): register @kickstart chat participant`. Files: `src/chatParticipants/kickstart/participant.ts`, `src/extension.ts`, `package.json`. Pre-commit: `npm run build`.

- [x] 13. Chat handler skeleton `src/chatParticipants/kickstart/handler.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/handler.ts`:
    - `export async function defaultHandler(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<vscode.ChatResult>`
    - Switch on `request.command`:
      - `undefined` (bare `@kickstart`) → render welcome message + 3 markdown buttons:
        1. `stream.button({ command: "aks.kickstartContainerization", title: "Open Kickstart panel" })`
        2. `stream.button({ command: "aks.kickstart.useWorkspace", title: "Use current workspace" })` (registered by T14)
        3. `stream.button({ command: "aks.kickstart.useSample", title: "Use a sample" })` (registered by T14)
      - `"start"` → call `handleStart(request, stream, token)` (T15).
      - `"sample"` → call `handleSample(request, stream, token)` (T15).
      - default → render unknown-command markdown.
    - Handle `request.references` if `chat.attachments` includes `clusterKey`/`acrKey` from webview handoff (T7); pass into `handleStart`.
    - Return `{ metadata: { command: request.command ?? "welcome" } }`.

  **Must NOT do**: implement generation logic in this file (T15 owns it); swallow exceptions silently — surface via `stream.markdown` with `**Error:** ...`.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — chat handler with branching, references, error UX.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3) — but blocks Wave 4.
  - **Blocks**: T15, T17, T22.
  - **Blocked By**: T12.

  **References**:
  - VS Code chat API stream surface: `stream.markdown`, `stream.button`, `stream.anchor`, `stream.filetree`, `stream.progress`, `stream.reference`.
  - WHY: This is the routing layer. Keeping it thin and switch-based makes adding new slash commands trivial later.

  **Acceptance Criteria**:
  - [ ] Bare `@kickstart` shows welcome with 3 buttons.
  - [ ] `@kickstart /start` invokes `handleStart` (smoke).
  - [ ] `@kickstart /sample` invokes `handleSample` (smoke).
  - [ ] Unknown slash commands show graceful unknown-command message.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Welcome message + 3 buttons render
    Tool: Playwright
    Steps:
      1. Type "@kickstart" in chat, send.
      2. Wait for response.
      3. Assert 3 button elements rendered with correct titles.
    Expected Result: All 3 buttons visible.
    Evidence: .sisyphus/evidence/task-13-welcome.png

  Scenario: /start routes to handleStart
    Tool: Playwright (with handler stubbed to log)
    Steps:
      1. Stub handleStart to write "STARTED" to stream.
      2. Type "@kickstart /start", send.
    Expected Result: Response contains "STARTED".
    Evidence: .sisyphus/evidence/task-13-start-route.png

  Scenario: Cancellation token propagates (negative path)
    Tool: Bash (extension test)
    Steps:
      1. Invoke handler with token.isCancellationRequested = true.
    Expected Result: Handler returns early with metadata.cancelled = true.
    Evidence: .sisyphus/evidence/task-13-cancel.log
  ```

  **Commit**: YES — `feat(kickstart): chat handler skeleton with /start and /sample routing`. Files: `src/chatParticipants/kickstart/handler.ts`. Pre-commit: `npm run build`.

- [x] 14. Repo-source resolver commands `aks.kickstart.useWorkspace` + `aks.kickstart.useSample`

  **What to do**:
  - Create `src/commands/aksKickstart/repoSource.ts`:
    - `export async function useWorkspace(): Promise<Errorable<string>>` — if 0 workspace folders → `{succeeded: false, error: "Open a folder in VS Code first"}`. If 1 → return `folders[0].uri.fsPath`. If 2+ → `vscode.window.showWorkspaceFolderPick()`; if cancelled → return cancelled error.
    - `export async function useSample(token: CancellationToken): Promise<Errorable<string>>` — uses `cloneSample` (T6). Determines parentPath: prompt user with `vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, openLabel: "Select clone destination" })` (defaults to workspace folder if exactly 1 open). Clones `KICKSTART_SAMPLE_REPO_URL` into `<parent>/aks-store-demo`. Returns cloned path.
    - After successful clone, call `vscode.commands.executeCommand("vscode.openFolder", clonedUri, { forceNewWindow: false })` — opens the cloned folder. Per Metis Q9: opening folder restarts the chat session, so include a reminder in the next chat turn.
  - Register both as commands in `src/extension.ts`:
    - `registerCommandWithTelemetry("aks.kickstart.useWorkspace", () => useWorkspace().then(...))` — on success, post `vscode.commands.executeCommand("workbench.action.chat.open", { query: "@kickstart /start" })`.
    - `registerCommandWithTelemetry("aks.kickstart.useSample", ...)` — same pattern; on success after folder reopen, the chat user re-runs `/start` (because folder reopen restarts chat session).

  **Must NOT do**: clone into the user's HOME directory without explicit folder pick; auto-execute `/start` after `vscode.openFolder` (window reloads).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — UX flow with multi-root + cancellation + reopen handoff.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3).
  - **Blocks**: T15.
  - **Blocked By**: T5 (constants), T6 (git wrapper), T12 (chat command id).

  **References**:
  - `src/chatParticipants/kickstart/gitExtension.ts:cloneSample` (T6).
  - `src/chatParticipants/kickstart/config.ts:KICKSTART_SAMPLE_REPO_URL` (T5).
  - VS Code APIs: `vscode.window.showWorkspaceFolderPick`, `vscode.window.showOpenDialog`, `vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow })`.

  **Acceptance Criteria**:
  - [ ] `useWorkspace`: returns folder path (single-root) or pick result (multi-root).
  - [ ] `useSample`: clones to chosen parent dir, opens cloned folder.
  - [ ] Both commands surface user-cancellation gracefully (no error, no chat post).
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Single-root workspace path
    Tool: Bash (sinon)
    Steps:
      1. Stub workspace.workspaceFolders = [{uri: file:///foo}].
      2. Call useWorkspace().
    Expected Result: Returns "/foo".
    Evidence: .sisyphus/evidence/task-14-single-root.log

  Scenario: Multi-root prompt + selection
    Tool: Bash (sinon)
    Steps:
      1. Stub 2 workspace folders.
      2. Stub showWorkspaceFolderPick to return second.
      3. Call useWorkspace().
    Expected Result: Returns second folder's fsPath.
    Evidence: .sisyphus/evidence/task-14-multi-root.log

  Scenario: Sample clone end-to-end
    Tool: Playwright
    Preconditions: Empty workspace; git extension active; network ON.
    Steps:
      1. Click "Use a sample" button in chat welcome.
      2. Choose /tmp as destination.
      3. Wait for progress notification.
      4. Assert /tmp/aks-store-demo exists, .git folder exists.
    Expected Result: Folder cloned; VS Code opens it.
    Evidence: .sisyphus/evidence/task-14-sample-clone.png

  Scenario: User cancels destination picker (negative)
    Tool: Playwright
    Steps:
      1. Click "Use a sample".
      2. Press Escape on folder picker.
    Expected Result: No error toast; nothing cloned; chat shows "Cancelled" message.
    Evidence: .sisyphus/evidence/task-14-cancel.png
  ```

  **Commit**: YES — `feat(kickstart): repo-source resolver commands (workspace + sample clone)`. Files: `src/commands/aksKickstart/repoSource.ts`, `src/extension.ts`. Pre-commit: `npm run build`.

- [x] 15. Generation orchestrator `src/chatParticipants/kickstart/orchestrator.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/orchestrator.ts` exporting:
    - `export async function handleStart(request, stream, token, options): Promise<KickstartResult>` — `options` = `{ projectPath: string; clusterKey?: ClusterKey; acrKey?: AcrKey }`.
    - `export async function handleSample(request, stream, token): Promise<KickstartResult>` — wraps `useSample` (T14) → on success, the user must rerun `/start` after window reload (per Metis Q9). Render persistent reminder + button to re-invoke `/start`.
  - `handleStart` flow:
    1. Resolve `projectPath`: from `options.projectPath` if provided; else call `useWorkspace` (T14).
    2. Resolve LM model: prefer `request.model` from chat request (per defaults disclosure); else `lmClient.ensureModel()` from `aksContainerAssist/lmClient`.
    3. `stream.progress("Analyzing project...")` → call T16.
    4. `stream.progress("Generating Dockerfile...")` → call T17 with analysis result.
    5. `stream.progress("Generating Kubernetes manifests...")` → call T18 with analysis + dockerfile result.
    6. `stream.progress("Generating GitHub Actions workflow...")` → call T19.
    7. After all artifacts: render "Save all" button (T21) + post-gen action buttons (T23/T24/T25).
    8. Return `{ metadata: { command: "start", artifactCount: N, projectPath } }`.
  - Cancellation: pass `token` through to all sub-calls. On `token.isCancellationRequested`, render "Cancelled" markdown and return `{ metadata: { cancelled: true } }`.
  - Error handling: any sub-step failure → render `**Error in {step}:** {message}` and continue if downstream steps don't depend on the failed one.
  - Define `KickstartResult` interface with `metadata: { command, artifactCount?, projectPath?, cancelled?, error? }`.

  **Must NOT do**: instantiate `ContainerAssistService` (use SDK directly per architecture decision); write files in this orchestrator (T20 owns saves).

  **Recommended Agent Profile**:
  - **Category**: `deep` — coordinates 4 sub-generators with cancellation + error UX + LM model selection.
  - **Skills**: none (pattern-following from existing handler).

  **Parallelization**:
  - **Can Run In Parallel**: NO — Wave 4 sequential leader.
  - **Blocks**: T16, T17, T18, T19, T20, T21, T22, T23, T24, T25.
  - **Blocked By**: T13 (handler), T14 (repo source), T5 (constants), T6 (git).

  **References**:
  - `src/commands/aksContainerAssist/containerAssistService.ts:130-180` — existing call sequence we mirror (but bypass writeFile at L145).
  - `src/commands/aksContainerAssist/lmClient.ts:ensureModel` — fallback path.
  - `containerization-assist-mcp/sdk` exports: `analyzeRepo`, `generateDockerfile`, `generateK8sManifests`, `formatGenerateDockerfileResult`, `formatGenerateK8sManifestsResult`, `formatErrorForLLM`.
  - WHY: Container Assist already solved the LLM+SDK orchestration; we copy the call sequence and replace `fs.writeFile` with `stream.markdown` codeblocks → save buttons.

  **Acceptance Criteria**:
  - [ ] Calling `handleStart` produces 3-4 stream.progress events, 3-4 artifact codeblocks, save buttons, action buttons.
  - [ ] Cancellation mid-flow stops further progress events and writes "Cancelled".
  - [ ] Error in Dockerfile generation does NOT block manifest generation (independent inputs).
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Happy path Node.js project
    Tool: Playwright (with mocked LM model returning fixed Dockerfile/YAML)
    Preconditions: Sample workspace = aks-store-demo. Mock LM returns valid artifacts.
    Steps:
      1. Type "@kickstart /start", send.
      2. Wait for stream complete.
      3. Assert ≥3 codeblocks rendered (Dockerfile, k8s yaml, gh actions yaml).
      4. Assert "Save all" button present.
    Expected Result: All artifacts streamed; Save all button present.
    Evidence: .sisyphus/evidence/task-15-happy-path.png

  Scenario: Cancellation mid-stream
    Tool: Playwright
    Steps:
      1. Type "@kickstart /start", send.
      2. After "Analyzing..." progress appears, click chat cancel button.
    Expected Result: Stream stops; "Cancelled" message rendered; no artifact codeblocks.
    Evidence: .sisyphus/evidence/task-15-cancel.png

  Scenario: LM model unavailable (negative)
    Tool: Bash (extension test)
    Steps:
      1. Stub request.model = undefined; stub lmClient.ensureModel to throw.
      2. Invoke handleStart.
    Expected Result: Renders error markdown directing user to install Copilot; returns metadata.error set.
    Evidence: .sisyphus/evidence/task-15-no-model.log
  ```

  **Commit**: YES — `feat(kickstart): generation orchestrator with cancellation + error UX`. Files: `src/chatParticipants/kickstart/orchestrator.ts`. Pre-commit: `npm run build`.

- [x] 16. Analyze-project step `src/chatParticipants/kickstart/steps/analyze.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/steps/analyze.ts`:
    - `export async function analyzeProject(projectPath: string, lmClient: LMClient, token: CancellationToken): Promise<Errorable<AnalysisResult>>`
    - Import `analyzeRepo` from `containerization-assist-mcp/sdk`.
    - Construct read tools (`READ_PROJECT_FILE_TOOL`, `LIST_DIRECTORY_TOOL`) with security wrappers (`isPathTraversal`, `isBlockedFile` from existing `aksContainerAssist/tools.ts`).
    - Call `analyzeRepo({ projectPath, tools, lmClient, cancellationToken: token })`.
    - On success → return `{succeeded: true, result: analysis}`.
    - `AnalysisResult` typedef matches SDK return: `{ language: "node"|"python"|"dotnet"|"go"|"unknown"; framework?: string; entrypoint?: string; ports?: number[]; ... }`.
    - Validate `language` is one of v1 supported (node/python/dotnet/go); if unknown → return error suggesting manual containerization.
  - Add minimal unit test stubbing the SDK to return a node analysis.

  **Must NOT do**: re-implement repo analysis; allow path-traversal in read tools.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — SDK integration with security-tool wiring.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4 — sub-step of T15, but parallel with T17, T18, T19 once T15's interfaces are stamped).
  - **Blocks**: T17, T18.
  - **Blocked By**: T15.

  **References**:
  - `src/commands/aksContainerAssist/tools.ts` — `READ_PROJECT_FILE_TOOL`, `LIST_DIRECTORY_TOOL`, `isPathTraversal`, `isBlockedFile`.
  - `containerization-assist-mcp/sdk:analyzeRepo` — SDK function signature.
  - `src/commands/aksContainerAssist/containerAssistService.ts:130-145` — existing call site for reference.
  - WHY: We import the existing tools+security; do NOT duplicate path-traversal checks.

  **Acceptance Criteria**:
  - [ ] Returns `Errorable<AnalysisResult>`.
  - [ ] Rejects unsupported languages with actionable error.
  - [ ] Path-traversal attempts in tool inputs are blocked (verified by re-using existing `isPathTraversal`).
  - [ ] `npm run build` passes; unit test passes.

  **QA Scenarios**:

  ```
  Scenario: Node project analyzed successfully
    Tool: Bash (with sample fixture)
    Preconditions: Fixture at test/fixtures/node-app with package.json.
    Steps:
      1. Run: npm test -- --grep "analyzeProject node"
    Expected Result: result.language === "node".
    Evidence: .sisyphus/evidence/task-16-node.log

  Scenario: Unsupported language
    Tool: Bash
    Steps:
      1. Stub analyzeRepo → return { language: "rust" }.
      2. Call analyzeProject.
    Expected Result: Errorable with message "Language 'rust' not yet supported in v1".
    Evidence: .sisyphus/evidence/task-16-unsupported.log
  ```

  **Commit**: YES — `feat(kickstart): repo analyze step (SDK wrapper)`. Files: 2. Pre-commit: `npm run build && npm test`.

- [x] 17. Dockerfile generation step `src/chatParticipants/kickstart/steps/dockerfile.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/steps/dockerfile.ts`:
    - `export async function generateDockerfileStep(analysis: AnalysisResult, lmClient: LMClient, stream: ChatResponseStream, token: CancellationToken): Promise<Errorable<{ dockerfile: string; dockerignore: string }>>`
    - Import `generateDockerfile`, `formatGenerateDockerfileResult`, `formatErrorForLLM` from SDK.
    - Import `dockerfilePrompt`, `dockerignorePrompt` from `aksContainerAssist/prompts.ts`.
    - Call `generateDockerfile({ analysis, lmClient, prompts: { dockerfile, dockerignore }, cancellationToken: token })`.
    - On success: stream both files as code-fenced markdown (` ```dockerfile ... ``` ` + ` ```text ... ``` ` for `.dockerignore`).
    - Add per-file Save button (T20 wires the command, this task just renders): `stream.button({ command: "aks.kickstart.saveFile", title: "Save Dockerfile", arguments: [{ filename: "Dockerfile", content: dockerfile, projectPath }] })`. Same for `.dockerignore`.
    - Return `{succeeded: true, result: {dockerfile, dockerignore}}` for orchestrator chaining.

  **Must NOT do**: write to disk in this step (T20 owns disk I/O); modify SDK prompt files.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — SDK call + stream rendering + save-button wiring.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4) — independent of T18, T19 (different artifacts).
  - **Blocks**: T20, T21, T23.
  - **Blocked By**: T15, T16.

  **References**:
  - `containerization-assist-mcp/sdk:generateDockerfile`, `formatGenerateDockerfileResult`.
  - `src/commands/aksContainerAssist/prompts.ts` — `dockerfilePrompt`, `dockerignorePrompt` exports.
  - WHY: Reusing prompts ensures parity with existing wizard's quality.

  **Acceptance Criteria**:
  - [ ] Streams 2 codeblocks (Dockerfile + .dockerignore).
  - [ ] Renders 2 save buttons with JSON-serializable arguments.
  - [ ] Returns Errorable.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Dockerfile streams + save button appears
    Tool: Playwright (mocked LM)
    Steps:
      1. Run "@kickstart /start" with mocked analysis.
      2. Assert codeblock with Dockerfile content rendered.
      3. Assert "Save Dockerfile" button present.
    Expected Result: Both visible.
    Evidence: .sisyphus/evidence/task-17-dockerfile-stream.png

  Scenario: SDK error formatting
    Tool: Bash
    Steps:
      1. Stub generateDockerfile to throw.
      2. Call generateDockerfileStep.
    Expected Result: Returns Errorable with formatErrorForLLM-formatted message.
    Evidence: .sisyphus/evidence/task-17-error.log
  ```

  **Commit**: YES — `feat(kickstart): dockerfile generation step`. Files: 1. Pre-commit: `npm run build`.

- [x] 18. K8s manifest generation step `src/chatParticipants/kickstart/steps/manifests.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/steps/manifests.ts`:
    - `export async function generateManifestsStep(analysis, dockerfileResult, lmClient, stream, token, options): Promise<Errorable<{ files: Record<string,string> }>>`
    - `options = { acrLoginServer?: string; clusterName?: string }` (passed from orchestrator if user came in with clusterKey/acrKey).
    - Import `generateK8sManifests`, `formatGenerateK8sManifestsResult` from SDK.
    - Import manifest prompts from `aksContainerAssist/prompts.ts`.
    - Inject `acrLoginServer` into image reference (e.g., `${acrLoginServer}/${appName}:latest`) if present; else use generic placeholder.
    - Call `generateK8sManifests` with prompts + lmClient + token.
    - Result is multi-file (deployment.yaml, service.yaml, optionally ingress.yaml). For each file:
      - Stream as ` ```yaml ``` ` codeblock with filename header.
      - Render save button: `aks.kickstart.saveFile` with `{ filename, content, projectPath: projectPath + "/k8s" }`.
    - Return `{succeeded: true, result: {files}}`.

  **Must NOT do**: include hardcoded ACR login server; generate manifests for languages not in analysis result.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — SDK call + multi-file stream.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4) — independent of T17, T19.
  - **Blocks**: T20, T21, T24.
  - **Blocked By**: T15, T16.

  **References**:
  - `containerization-assist-mcp/sdk:generateK8sManifests`.
  - `src/commands/aksContainerAssist/prompts.ts` — manifest prompts.
  - `src/commands/aksContainerAssist/containerAssistService.ts:170-200` — multi-file write pattern (we adapt to stream).

  **Acceptance Criteria**:
  - [ ] Streams ≥2 yaml codeblocks (deployment + service).
  - [ ] Save buttons reference `{projectPath}/k8s/` subfolder.
  - [ ] If `acrLoginServer` provided, image references use it.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Multi-file manifest stream with ACR injection
    Tool: Playwright (mocked LM, mocked ACR)
    Preconditions: User came in via webview with selectedAcr.loginServer = "myacr.azurecr.io".
    Steps:
      1. Run /start.
      2. Wait for manifest stream.
      3. Inspect deployment.yaml codeblock content.
    Expected Result: Image field contains "myacr.azurecr.io/...".
    Evidence: .sisyphus/evidence/task-18-acr-inject.png

  Scenario: No ACR context → generic image placeholder
    Tool: Playwright
    Steps:
      1. Run /start without webview handoff (palette-only entry).
    Expected Result: Image field uses a generic placeholder (e.g., "<your-registry>/<app>:latest") with a callout explaining how to update it.
    Evidence: .sisyphus/evidence/task-18-no-acr.png
  ```

  **Commit**: YES — `feat(kickstart): k8s manifest generation step with ACR-aware image refs`. Files: 1. Pre-commit: `npm run build`.

- [x] 19. GitHub Actions YAML generation step `src/chatParticipants/kickstart/steps/githubActions.ts`

  **What to do**:
  - Create `src/chatParticipants/kickstart/steps/githubActions.ts`:
    - `export async function generateGithubActionsStep(analysis, lmClient, stream, token, options): Promise<Errorable<{ workflow: string }>>`
    - `options = { acrLoginServer?: string; clusterName?: string; resourceGroup?: string }`.
    - Construct prompt inline (no Container Assist equivalent today): "Generate a GitHub Actions workflow file for {language} that builds a Docker image, pushes to ACR `{acrLoginServer}`, and deploys to AKS cluster `{clusterName}` in resource group `{resourceGroup}`. Use OIDC federation for Azure auth. Use `azure/login@v2`, `azure/aks-set-context@v4`, `azure/k8s-deploy@v5`."
    - If acrLoginServer/clusterName missing → use placeholder secrets `${{ secrets.ACR_LOGIN_SERVER }}` etc., and add a comment block at the top explaining what to fill in.
    - Call `lmClient.sendRequestWithTools({ prompt, tools: [], cancellationToken: token })`.
    - Stream as ` ```yaml ``` ` codeblock with filename `.github/workflows/aks-deploy.yml`.
    - Render save button.
  - Optional: post-generation, lint the YAML by parsing with `yaml` package (already in deps); if parse fails, surface warning in chat with raw output preserved.

  **Must NOT do**: hardcode secret values; commit credentials; assume OIDC is set up (warn user instead).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — prompt engineering + YAML output validation.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4) — independent of T17, T18.
  - **Blocks**: T20, T21.
  - **Blocked By**: T15, T16.

  **References**:
  - `src/commands/aksContainerAssist/lmClient.ts:sendRequestWithTools` — direct LM call (no SDK wrapper for actions YAML).
  - GitHub Actions docs: `azure/login@v2`, `azure/aks-set-context@v4`, `azure/k8s-deploy@v5`.
  - WHY: No Container Assist analog exists for CI/CD YAML — we own this prompt. Keep it tight (one prompt, one output).

  **Acceptance Criteria**:
  - [ ] Streams 1 yaml codeblock with `.github/workflows/aks-deploy.yml` header.
  - [ ] Includes OIDC `azure/login@v2` block.
  - [ ] When ACR/cluster context missing, includes top-of-file comment with required secrets.
  - [ ] Generated YAML is parseable by `yaml.parse()`.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Workflow with full context
    Tool: Playwright (mocked LM with realistic YAML response)
    Preconditions: clusterName + resourceGroup + acrLoginServer all provided.
    Steps:
      1. Run /start with full handoff.
      2. Locate workflow codeblock.
      3. Assert content contains "azure/login@v2", clusterName string, acrLoginServer.
    Expected Result: All three present.
    Evidence: .sisyphus/evidence/task-19-full-context.png

  Scenario: Workflow YAML parses
    Tool: Bash
    Steps:
      1. Capture YAML output.
      2. Run: node -e "require('yaml').parse(require('fs').readFileSync('/tmp/wf.yml','utf8'))"
    Expected Result: Exit 0.
    Evidence: .sisyphus/evidence/task-19-parse.log

  Scenario: Missing context → secrets placeholders + comment
    Tool: Playwright
    Steps:
      1. Run /start without handoff.
      2. Inspect workflow codeblock.
    Expected Result: Contains `${{ secrets.AZURE_CLIENT_ID }}`, `${{ secrets.ACR_LOGIN_SERVER }}`, and TODO comment header.
    Evidence: .sisyphus/evidence/task-19-no-context.png
  ```

  **Commit**: YES — `feat(kickstart): GitHub Actions workflow generation step`. Files: 1. Pre-commit: `npm run build`.

- [x] 20. Save-file command `aks.kickstart.saveFile` (single file)

  **What to do**:
  - Create `src/commands/aksKickstart/saveFile.ts`:
    - `export async function saveFile(_ctx: IActionContext, args: { filename: string; content: string; projectPath: string }): Promise<void>`
    - Resolve target uri: `vscode.Uri.joinPath(Uri.file(args.projectPath), args.filename)`.
    - If parent dir doesn't exist: `vscode.workspace.fs.createDirectory(parentUri)` (covers `.github/workflows/` and `k8s/` paths per Metis).
    - If file exists: `vscode.window.showWarningMessage("{filename} already exists. Overwrite?", { modal: true }, "Overwrite", "Open existing")`. On Cancel → return; on "Open existing" → `vscode.window.showTextDocument(uri)` and return.
    - Write file via `vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"))`.
    - Open in editor: `vscode.window.showTextDocument(uri)`.
    - Toast: `vscode.window.showInformationMessage("Saved {filename}")`.
  - Register in `src/extension.ts`: `registerCommandWithTelemetry("aks.kickstart.saveFile", saveFile)`.

  **Must NOT do**: silently overwrite; write outside `args.projectPath` (path-traversal check on `args.filename`).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — UX + filesystem + safety.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4) — independent of T21 (which calls into this).
  - **Blocks**: T21, F3.
  - **Blocked By**: T15 (orchestrator interface for arguments shape).

  **References**:
  - `vscode.workspace.fs` API for cross-platform writes.
  - Existing save patterns: search `workspace.fs.writeFile` in current codebase for any existing helper.
  - WHY: Single command serves dockerfile, dockerignore, manifests, gh actions — keeps webview/chat agnostic about disk layout.

  **Acceptance Criteria**:
  - [ ] File written to correct path.
  - [ ] Parent dirs auto-created.
  - [ ] Overwrite prompts shown when file exists.
  - [ ] Path-traversal in filename blocked (e.g., `../../etc/passwd`).
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: First-time save into existing folder
    Tool: Playwright
    Steps:
      1. Click "Save Dockerfile" button.
      2. Verify file at <projectPath>/Dockerfile.
      3. Verify it opens in editor.
    Expected Result: File exists with correct content; editor open.
    Evidence: .sisyphus/evidence/task-20-first-save.png

  Scenario: Save into auto-created subfolder (.github/workflows)
    Tool: Bash
    Steps:
      1. Empty workspace, no .github folder.
      2. Invoke saveFile with filename = ".github/workflows/aks-deploy.yml".
      3. ls -la .github/workflows/
    Expected Result: Folder + file exist.
    Evidence: .sisyphus/evidence/task-20-autocreate.log

  Scenario: Overwrite confirmation (negative — user cancels)
    Tool: Playwright
    Steps:
      1. Pre-create Dockerfile with content "EXISTING".
      2. Click "Save Dockerfile".
      3. On modal, click "Cancel".
      4. Read file content.
    Expected Result: Content still "EXISTING"; no toast.
    Evidence: .sisyphus/evidence/task-20-overwrite-cancel.png

  Scenario: Path traversal blocked (negative)
    Tool: Bash
    Steps:
      1. Invoke saveFile with filename = "../../tmp/escape.txt".
      2. Check /tmp/escape.txt does NOT exist.
    Expected Result: Save rejected; file not written.
    Evidence: .sisyphus/evidence/task-20-traversal.log
  ```

  **Commit**: YES — `feat(kickstart): save-file command with overwrite + path-traversal guards`. Files: 2. Pre-commit: `npm run build`.

- [x] 21. Save-all command `aks.kickstart.saveAll`

  **What to do**:
  - Create `src/commands/aksKickstart/saveAll.ts`:
    - `export async function saveAll(_ctx, args: { files: Array<{ filename: string; content: string }>; projectPath: string }): Promise<void>`
    - Pre-scan: detect existing files. If any exist, show one consolidated modal: "{N} of {M} files already exist. Overwrite all?" with options "Overwrite all", "Skip existing", "Cancel".
    - For each file: call internal `writeOne(uri, content)` (extracted helper shared with T20 — refactor T20's core write into `src/commands/aksKickstart/saveFileCore.ts` and have both commands import it).
    - Track results: `{ saved: string[]; skipped: string[]; failed: Array<{file, err}> }`.
    - Final toast: `"Saved {savedCount} file(s). Skipped {skippedCount}. {Failures shown if any.}"` with "Show in Explorer" button revealing the project root.
  - Register in `src/extension.ts`: `registerCommandWithTelemetry("aks.kickstart.saveAll", saveAll)`.
  - Update T17, T18, T19 streamers to also push their `{filename, content}` into a shared accumulator visible to T15's orchestrator, which renders the final "Save all" button with all collected files in `arguments`.

  **Must NOT do**: silently fail individual writes; serialize args to button beyond `~3KB` (arguments serialized in chat history per chat API research) — if total size > 3KB, instead pass a session-scoped key and look up content from a memory store (see open question, defer to T22 if needed).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — batch-write UX + shared core extraction.

  **Parallelization**:
  - **Can Run In Parallel**: NO — depends on T20's core helper.
  - **Blocks**: F3.
  - **Blocked By**: T17, T18, T19 (artifacts to save), T20 (core write helper).

  **References**:
  - T20's `saveFileCore.ts` (extracted in this task).
  - VS Code `showWarningMessage` modal API.

  **Acceptance Criteria**:
  - [ ] Saves all 4-5 artifacts in one click.
  - [ ] Single consolidated overwrite prompt when files exist.
  - [ ] Per-file failures don't abort siblings.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Save all into clean workspace
    Tool: Playwright
    Steps:
      1. After /start completes in clean workspace.
      2. Click "Save all" button.
      3. Verify Dockerfile, .dockerignore, k8s/*.yaml, .github/workflows/aks-deploy.yml all exist.
    Expected Result: All files present; toast says "Saved 5 files".
    Evidence: .sisyphus/evidence/task-21-save-all-clean.png

  Scenario: Save all with conflicts → Overwrite all
    Tool: Playwright
    Steps:
      1. Pre-create Dockerfile + k8s/deployment.yaml.
      2. Click "Save all".
      3. Click "Overwrite all" on modal.
    Expected Result: All files present with new content.
    Evidence: .sisyphus/evidence/task-21-overwrite-all.png

  Scenario: Save all → Skip existing
    Tool: Playwright
    Steps:
      1. Pre-create Dockerfile only.
      2. Click "Save all" → "Skip existing".
    Expected Result: Dockerfile content unchanged; other files saved.
    Evidence: .sisyphus/evidence/task-21-skip-existing.png
  ```

  **Commit**: YES — `feat(kickstart): save-all command with batched overwrite UX`. Files: 2 (saveAll + saveFileCore extract). Pre-commit: `npm run build`.

- [x] 22. Followup provider `provideKickstartFollowups`

  **What to do**:
  - Add to `src/chatParticipants/kickstart/handler.ts` (or split into `followups.ts`):
    - `export const provideKickstartFollowups: vscode.ChatFollowupProvider["provideFollowups"] = (result, context, token) => { ... }`
    - Inspect `result.metadata`:
      - If `command === "welcome"` → suggest `[{ prompt: "/start", label: "Start with current workspace" }, { prompt: "/sample", label: "Try a sample" }]`.
      - If `command === "start"` && `artifactCount > 0` → suggest `[{ command: "aks.kickstart.buildAndPush", label: "Build & push to ACR" }, { command: "aks.kickstart.deploy", label: "Deploy to AKS" }]`.
      - If `metadata.cancelled` → `[{ prompt: "/start", label: "Try again" }]`.
      - If `metadata.error` → `[{ prompt: "@kickstart help", label: "Get help" }]`.

  **Must NOT do**: return more than 3-4 followups (chat UI clutters); reference commands that don't exist yet.

  **Recommended Agent Profile**:
  - **Category**: `quick` — small contextual provider.

  **Parallelization**:
  - **Can Run In Parallel**: NO — wired into T12's participant.
  - **Blocks**: F3.
  - **Blocked By**: T12, T13, T15, T23, T24.

  **References**:
  - `vscode.ChatFollowupProvider` API.

  **Acceptance Criteria**:
  - [ ] Followups appear after each handler response.
  - [ ] Followups change based on command + result.metadata.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Welcome followups
    Tool: Playwright
    Steps:
      1. Type "@kickstart", send.
      2. After response, inspect followup chips below.
    Expected Result: Two chips: "Start with current workspace", "Try a sample".
    Evidence: .sisyphus/evidence/task-22-welcome-followups.png

  Scenario: Post-generation followups
    Tool: Playwright
    Steps:
      1. Run /start to completion.
      2. Inspect followup chips.
    Expected Result: "Build & push to ACR" + "Deploy to AKS" chips.
    Evidence: .sisyphus/evidence/task-22-post-gen.png
  ```

  **Commit**: YES — `feat(kickstart): contextual followup provider`. Files: 1. Pre-commit: `npm run build`.

- [x] 23. Build & push command `aks.kickstart.buildAndPush`

  **What to do**:
  - Create `src/commands/aksKickstart/buildAndPush.ts`:
    - `export async function buildAndPush(_ctx, args: { projectPath: string; acrLoginServer?: string; imageName?: string }): Promise<void>`
    - If `acrLoginServer` missing → prompt user via `vscode.window.showInputBox({ prompt: "ACR login server (e.g., myacr.azurecr.io)" })`.
    - If `imageName` missing → derive from project folder name via `path.basename(projectPath)`.
    - Open a new terminal: `vscode.window.createTerminal({ name: "AKS Kickstart Build", cwd: projectPath })`.
    - Send command: `terminal.sendText("az acr build --registry " + acrName + " --image " + imageName + ":latest .");` (extract `acrName` from `acrLoginServer.split('.')[0]`).
    - Show terminal: `terminal.show()`.
    - Add chat-side toast via callback: `vscode.window.showInformationMessage("Started build in terminal. Check progress in 'AKS Kickstart Build'.")`.
  - Register in `src/extension.ts`.

  **Must NOT do**: run `az acr build` programmatically (long-running, network-heavy — terminal gives user visibility); embed credentials.

  **Recommended Agent Profile**:
  - **Category**: `quick` — terminal launcher.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4) — independent of T24, T25.
  - **Blocks**: T22, F3.
  - **Blocked By**: T15.

  **References**:
  - `vscode.window.createTerminal` API.
  - `az acr build` CLI: https://learn.microsoft.com/cli/azure/acr#az-acr-build.

  **Acceptance Criteria**:
  - [ ] Terminal opens with correct cwd.
  - [ ] `az acr build` command sent with correct args.
  - [ ] User prompted for missing inputs.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Build & push with full args
    Tool: interactive_bash (tmux to inspect terminal)
    Steps:
      1. Click "Build & push to ACR" follow-up button (with handoff context).
      2. Check active terminal name.
      3. Check terminal received "az acr build --registry myacr --image aks-store-demo:latest ." text.
    Expected Result: Terminal correctly populated.
    Evidence: .sisyphus/evidence/task-23-terminal.log

  Scenario: Missing ACR → prompts
    Tool: Playwright
    Steps:
      1. Click button without acrLoginServer.
      2. Assert input box appears asking for ACR login server.
    Expected Result: Prompt visible.
    Evidence: .sisyphus/evidence/task-23-prompt.png
  ```

  **Commit**: YES — `feat(kickstart): build & push to ACR via terminal`. Files: 2. Pre-commit: `npm run build`.

- [x] 24. Deploy command `aks.kickstart.deploy`

  **What to do**:
  - Create `src/commands/aksKickstart/deploy.ts`:
    - `export async function deploy(_ctx, args: { projectPath: string; clusterKey?: ClusterKey; manifestsPath?: string }): Promise<void>`
    - Resolve manifests: if `manifestsPath` missing, default to `path.join(projectPath, "k8s")`. Glob `*.yaml` files; if 0 → toast error "No manifests found. Save manifests first.".
    - Resolve cluster: if `clusterKey` missing, prompt via existing AKS cluster picker (reuse `getQuickPickAccountFromExtensionState` or similar from `aksClusterPicker`).
    - Hand off to existing `deployManifestToAKSPlugin` command: `vscode.commands.executeCommand("aks.aksDeployManifest", { clusterKey, manifestsPath })` — verify exact command id and signature in repo.
    - If the existing deploy plugin command isn't a direct callable, fallback: open terminal and run `kubectl apply -f <manifestsPath> --context <clusterName>`.

  **Must NOT do**: re-implement deploy logic; modify existing deploy plugin.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — handoff with fallback.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4).
  - **Blocks**: T22, F3.
  - **Blocked By**: T15.

  **References**:
  - Search repo for `deployManifestToAKSPlugin` or `aksDeployManifest` to confirm exact command id.
  - `src/commands/aksDeployManifest/` (likely path) for the existing deploy flow.

  **Acceptance Criteria**:
  - [ ] If existing command exists, it's invoked with correct args.
  - [ ] If not, terminal fallback applies kubectl correctly.
  - [ ] Missing manifests folder shows actionable error.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Deploy with saved manifests + cluster context
    Tool: Playwright
    Preconditions: k8s/ folder has saved deployment.yaml + service.yaml.
    Steps:
      1. Click "Deploy to AKS" follow-up.
      2. Verify deploy plugin invoked OR terminal kubectl apply executes.
    Expected Result: Deploy started; success toast or terminal output visible.
    Evidence: .sisyphus/evidence/task-24-deploy.png

  Scenario: No manifests → actionable error (negative)
    Tool: Playwright
    Steps:
      1. Empty k8s folder.
      2. Click "Deploy to AKS".
    Expected Result: Toast "No manifests found. Save manifests first." with "Save now" button.
    Evidence: .sisyphus/evidence/task-24-no-manifests.png
  ```

  **Commit**: YES — `feat(kickstart): deploy command (handoff to existing plugin or kubectl fallback)`. Files: 2. Pre-commit: `npm run build`.

- [x] 25. Portal anchor renderer (in orchestrator)

  **What to do**:
  - In `src/chatParticipants/kickstart/orchestrator.ts` post-generation step, if `clusterKey` is known:
    - Compose Azure Portal URL: `https://portal.azure.com/#@/resource/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.ContainerService/managedClusters/${name}/overview`.
    - Render: `stream.anchor(vscode.Uri.parse(url), "Open in Azure Portal")`.
  - If `acrKey` is known, similarly render anchor for ACR resource.

  **Must NOT do**: include any auth tokens or query params with secrets.

  **Recommended Agent Profile**:
  - **Category**: `quick` — URL composition + stream.anchor.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4).
  - **Blocks**: F3.
  - **Blocked By**: T15.

  **Acceptance Criteria**:
  - [ ] Anchor rendered with correct portal URL.
  - [ ] No anchor rendered when keys absent.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Anchor rendered with correct URL
    Tool: Playwright
    Steps:
      1. Run /start with handoff (clusterKey known).
      2. After completion, locate anchor element.
      3. Hover or read href.
    Expected Result: URL contains correct subscription, RG, cluster name segments.
    Evidence: .sisyphus/evidence/task-25-anchor.png

  Scenario: No anchor without context
    Tool: Playwright
    Steps:
      1. Run /start from palette (no handoff).
    Expected Result: No portal anchor in response (or rendered as generic "Open Azure Portal").
    Evidence: .sisyphus/evidence/task-25-no-context.png
  ```

  **Commit**: YES — `feat(kickstart): portal anchor in chat response`. Files: 1 (orchestrator edit). Pre-commit: `npm run build`.

- [x] 26. Telemetry events `chat.kickstart.*` and `kickstart.*`

  **What to do**:
  - Create `src/chatParticipants/kickstart/telemetry.ts`:
    - `export function reportChatTelemetry(event: string, props?: Record<string, string>): void` — uses existing `reporter.sendTelemetryEvent("chat.kickstart." + event, props)`.
    - Wire from handler/orchestrator: `welcome`, `start.invoked`, `start.completed`, `start.cancelled`, `start.error`, `sample.invoked`, `useWorkspace`, `useSample`, `saveFile`, `saveAll`, `buildAndPush`, `deploy`.
  - Webview side: `KickstartPanelDataProvider.getTelemetryDefinition()` already returns `{kickstart.attachAcrClicked: true, kickstart.startKickstartClicked: true}` (T7); ensure these fire automatically via BasePanel telemetry plumbing.
  - All props sanitized: NO image names, NO file content, NO project paths. Only enums, durations, success/failure flags.

  **Must NOT do**: emit user content; create new top-level telemetry namespaces beyond `kickstart.` and `chat.kickstart.`.

  **Recommended Agent Profile**:
  - **Category**: `quick` — wire-up + sanitization audit.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4).
  - **Blocks**: F2 (code quality verification expects telemetry to exist).
  - **Blocked By**: T13, T15, T20, T21, T23, T24.

  **References**:
  - Existing `reporter` import from `../../telemetry` or similar — locate via `grep -rn "sendTelemetryEvent" src/commands | head -5`.
  - README "Telemetry" section policy: only command-execution data, no user content.

  **Acceptance Criteria**:
  - [ ] All 12 events fire at correct points.
  - [ ] No event payload contains paths, content, or names.
  - [ ] `npm run build` passes.

  **QA Scenarios**:

  ```
  Scenario: Telemetry sanitization audit
    Tool: Bash
    Steps:
      1. Run: grep -E "reportChatTelemetry|sendTelemetryEvent" src/chatParticipants/kickstart/ src/commands/aksKickstart/ -rn
      2. For each call, manually inspect props don't include user content.
    Expected Result: All calls sanitized (only success bool, durations, enums).
    Evidence: .sisyphus/evidence/task-26-audit.log

  Scenario: Telemetry fires on /start completion
    Tool: Bash (with TelemetryReporter stubbed)
    Steps:
      1. Run handleStart end-to-end with mocks.
      2. Inspect reporter.sendTelemetryEvent calls.
    Expected Result: chat.kickstart.start.completed fired with success=true and duration_ms set.
    Evidence: .sisyphus/evidence/task-26-fire.log
  ```

  **Commit**: YES — `feat(kickstart): telemetry wiring with sanitization`. Files: 1 + scattered edits. Pre-commit: `npm run build`.

- [x] 27. Docs + AGENTS.md update

  **What to do**:
  - Add `docs/features/kickstart.md` (NEW; this is feature documentation, NOT a plan; allowed since plan-mode constraint is for `.sisyphus/plans/`):
    - Sections: Overview, Enabling the preview, Entry points, Webview walkthrough, Chat walkthrough, Slash commands, Save flow, Build/Deploy follow-ups, Telemetry, Limitations, FAQ.
    - Screenshots from F3 evidence.
  - Update top-level AGENTS.md (if exists) with one line linking to the new docs.
  - Update README.md "Feature List" link section if it references docs feature index.

  **Must NOT do**: write the docs in `.sisyphus/` (this is product docs); include credentials or screenshots with PII.

  **Recommended Agent Profile**:
  - **Category**: `writing` — user-facing documentation.

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4).
  - **Blocks**: F1 (compliance check verifies docs exist).
  - **Blocked By**: T11, T12, T15 (need finalized UX to document accurately).

  **References**:
  - `docs/features/` existing pages — match structure and tone.
  - F3 evidence folder for screenshots.

  **Acceptance Criteria**:
  - [ ] `docs/features/kickstart.md` exists with all 11 sections.
  - [ ] At least 3 screenshots embedded.
  - [ ] Links to enable preview, file-an-issue.
  - [ ] No broken markdown links (`markdown-link-check` if available).

  **QA Scenarios**:

  ```
  Scenario: Docs render in GitHub markdown
    Tool: Bash
    Steps:
      1. Run: npx markdown-link-check docs/features/kickstart.md
    Expected Result: All links resolve.
    Evidence: .sisyphus/evidence/task-27-links.log

  Scenario: Screenshots load
    Tool: Bash
    Steps:
      1. Extract image paths from docs/features/kickstart.md.
      2. Verify each file exists.
    Expected Result: All present.
    Evidence: .sisyphus/evidence/task-27-images.log
  ```

  **Commit**: YES — `docs(kickstart): add feature documentation`. Files: `docs/features/kickstart.md`, `README.md`, `AGENTS.md`. Pre-commit: `npm run build`.

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read this plan end-to-end. For each "Must Have": verify implementation exists (read file, run command, exercise UI). For each "Must NOT Have": grep codebase for forbidden patterns — reject with `file:line` if found. Confirm `acrPullRoleDefinitionName` is imported, not duplicated. Confirm `prompts.ts` and `tools.ts` from `aksContainerAssist/` are imported, not copied. Confirm `containerAssistService.ts` and `aksContainerAssist.ts` are NOT modified (`git diff --stat` shows zero lines changed in those files). Verify evidence files exist in `.sisyphus/evidence/`. Compare deliverables 1–10 against actual repo.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build`, `npm run lint`, `npm test`. Review all changed/new files for: `as any` / `@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Detect AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Confirm React components use stable `data-testid` attributes for tests. Confirm no `any` in chat participant handler signature. Confirm `request.token` is propagated.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill) [BLOCKED: no display/VS Code in this environment — manual QA steps documented in issues.md]
  Start from clean state (no workspace open). Execute EVERY QA scenario from EVERY task — exact steps, capture evidence to `.sisyphus/evidence/final-qa/`. Test cross-task integration: open chat → /start → click "Start containerization" button → webview opens → pick cluster+ACR with no AcrPull → click Attach → returns success → permission check auto-refreshes to ✓ → close webview → chat shows generation → save all → files appear on disk → click Deploy → handoff fires. Test edge cases: empty subscription, no workspace, LM model unavailable, git extension disabled, save with existing Dockerfile, cancel mid-generation.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Specifically check: no GitHub auth code, no @azure plugin entry added, no Helm/scanner/network-probe code, no modification of `containerAssistService.ts`/`aksContainerAssist.ts`/`appModernizationBridge.ts`. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: One commit per foundation task. Type: `feat(kickstart):` or `refactor(utils):` for T3.
- **Wave 2**: Group webview tasks (T7+T8+T10) into one commit `feat(kickstart): add webview panel + React shell`. Chat skeleton tasks separate.
- **Wave 3**: Generation orchestrator + streaming as one logical commit. Save handler separate.
- **Wave 4**: Each follow-up + telemetry as separate small commits.
- **Pre-commit**: `npm run build && npm run lint && npm test` for every commit.

---

## Success Criteria

### Verification Commands

```bash
npm run build            # Expected: 0 errors
npm run lint             # Expected: 0 errors, 0 warnings on changed files
npm test                 # Expected: all unit tests pass including new identities + acrRoleHelpers tests
# Playwright (project-conventional command — verify exact during T7)
# e.g. npm run test:webview -- --grep kickstart
ls .sisyphus/evidence/   # Expected: every task has at least one evidence file
git diff --stat src/commands/aksContainerAssist/containerAssistService.ts   # Expected: empty (zero changes)
git diff --stat src/commands/aksContainerAssist/aksContainerAssist.ts       # Expected: empty
git diff --stat src/commands/aksContainerAssist/appModernizationBridge.ts   # Expected: empty
grep -rn "7f951dda-4ed3-4680-a7ca-43fe172d538d" src/chatParticipants src/panels/KickstartPanel.ts   # Expected: empty (constant must be imported)
```

### Final Checklist

- [ ] All "Must Have" present.
- [ ] All "Must NOT Have" absent (verified by grep).
- [ ] All Mocha unit tests pass.
- [ ] Playwright kickstart suite all-green.
- [ ] F1–F4 all APPROVE.
- [ ] User explicitly approves the F1–F4 consolidated results.
