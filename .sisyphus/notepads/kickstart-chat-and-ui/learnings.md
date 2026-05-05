# Learnings

## [2026-05-04] Session ses_20b3f63f1ffe1Y3J4NwPG7T2bG — Wave 1 start

### Codebase conventions
- Preview flags pattern: `aks.copilotEnabledPreview`, `aks.containerAssistEnabledPreview` in package.json
- Commands pattern: `registerCommandWithTelemetry("aks.xxx", handler)` in extension.ts
- Webview pattern: 7 files (contract → webviewTypes.ts → BasePanel subclass + PanelDataProvider → command → React app → main.tsx rendererLookup)
- Initial state via `data-initialstate` attr (BasePanel.ts:105-121)
- `acrPullRoleDefinitionName = "7f951dda-4ed3-4680-a7ca-43fe172d538d"` at attachAcrToCluster.ts:27 — MUST IMPORT, never duplicate
- `getClusterPrincipalId` duplicated in AttachAcrToClusterPanel.ts:256-309 AND aksAttachAcrToCluster/attachAcrToCluster.ts:426-467
- Container Assist SDK: analyzeRepo, generateDockerfile, generateK8sManifests, formatGenerateDockerfileResult, formatGenerateK8sManifestsResult, formatErrorForLLM
- ContainerAssistService.generateDockerfile calls writeFile at L145 — bypass by calling SDK + lmClient directly
- vscode.git API: extensions.getExtension('vscode.git').exports.getAPI(1).clone(url, parentPath)

### Kickstart config constants
- Added `src/chatParticipants/kickstart/config.ts` as the single source of truth for the sample repo URL, participant id/name, and content id.
- Added sanity tests that validate the sample repo URL shape and the publisher-prefixed participant id convention.
- `npm run test-compile` succeeds after installing dependencies with `--legacy-peer-deps`; full `npm test` still requires a display/X server for VS Code's electron test runner in this environment.

### Kickstart preview skeleton
- Added `aks.kickstartEnabledPreview` alongside the existing preview flags shape in `package.json`
- Added a placeholder `aks.kickstartContainerization` command contribution gated by `config.aks.kickstartEnabledPreview`
- Added empty `contributes.chatParticipants` scaffold for the future chat participant entries
- Repo currently has no `build` npm script, so `npm run build` is not available here
- `webview-ui` needed `npm install --legacy-peer-deps` before `npm run test-compile` would work because local dependency resolution was incompatible with the current eslint versions
- `npm test` in this environment fails at VS Code Electron startup without an X server / `$DISPLAY`; compile succeeds, but full integration test execution needs a display-capable runner
- For the built-in Git extension wrapper, `vscode.extensions.getExtension('vscode.git')` should be activated before reading `.exports.getAPI(1)`; missing API should surface a user-facing error rather than throwing
- The repo already has `src/types/git.d.ts`, but the kickstart wrapper intentionally uses a minimal inline `GitAPI`/exports shape per plan to keep the wrapper isolated.
- `cloneSample` should guard against unsafe `targetName` values and enforce containment under `parentPath`; otherwise the unique-name suffix loop could write outside the intended directory.
- `npm run test-compile` can succeed even when `lsp_diagnostics` is unavailable because local TS/biome servers are not installed in this environment.
- `src/extension.ts` had an unused `deploy` import that blocks compile under `noUnusedLocals`; removing it was required for this change.

### Kickstart command wiring
- `aks.kickstartContainerization` is now registered only when `aks.kickstartEnabledPreview` is true, matching the preview-flag pattern used elsewhere.
- The kickstart command resolves a preselected cluster only from AKS cloud-explorer tree nodes via `getAksClusterTreeNode`, so non-AKS targets are ignored.
- `npm run test-compile` succeeds after adding the missing webview-ui kickstart renderer and manual-test registry entries.

## Webview UI Structure
- Reused the `ResourceSelector` pattern for cascading dropdowns
- Added independent CSS classes in `Kickstart.module.css` to handle flex and permission layouts without using inline styles.
- Mapped VS Code message context directly using `getWebviewMessageContext<"kickstart">`
- Integrated UI to match `AttachAcrToCluster` style with grid layout constraints

## T15-T19 Kickstart generation orchestrator - 2026-05-04
- Kickstart generation bypasses ContainerAssistService disk writes by calling containerization-assist-mcp SDK plans directly, then LMClient.sendRequestWithTools with imported Container Assist prompts/tools.
- repoSource useWorkspace helper currently lives at src/commands/aksKickstart/repoSource.ts, not under chatParticipants/kickstart.
- test-compile is sufficient to validate TS when typescript-language-server is unavailable in this environment.
## 2026-05-04
- Kickstart start flow now emits telemetry for invoked/completed/cancelled/error states via a small shared wrapper around `reporter?.sendTelemetryEvent(...)`.
- Portal anchors can be added after the save button with `stream.anchor(vscode.Uri.parse(url), label)` for Azure Portal deep links.
- `vscode.ChatFollowup` command entries still need a `prompt` field in this codebase's typings, so command followups should include both `prompt` and `command` to satisfy `test-compile`.


## 2026-05-04 F4 scope fidelity check
- Verdict: REJECT. Chat participant/package command/feature flag/build passed, but webview panel backend handlers are stubs, so preflight pickers/permission checks/attach cannot function.
- `aks.kickstartContainerization` is contributed under commands and registered, but no command palette menu entry or tree-view context menu contribution exists for it.
- Kickstart webview posts `startKickstartRequest`, making the panel a generation entry point; original requirement says webview is preflight-only and generation is chat-only.
- No `7f951dda`, no `ContainerAssistService` import in kickstart chat participant files, and compile passes; LSP diagnostics unavailable because typescript-language-server is not installed.
