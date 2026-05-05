# VS Code Chat Participant API — Research Report

**Research Date**: 2026-05-04
**Source SHA**: [`microsoft/vscode@5c4d9a27`](https://github.com/microsoft/vscode/tree/5c4d9a275639b6ad7b2dad7192c07a5f2112c185/src/vscode-dts) (HEAD of `main` on 2026-05-04)
**Scope**: Stable + all proposed chat / language-model APIs as of May 2026.

> **TL;DR for the kickstart-plan decision**
>
> - **Stable API can NOT host arbitrary HTML / React / iframes inside the chat panel.** The only "rich" stable parts are markdown, anchors, file trees, command-buttons, references and progress.
> - **Proposed API `chatOutputRenderer` (since VS Code 1.103, July 2025) IS the official path to render arbitrary webview-based UI inline in chat** — flame graphs, charts, custom widgets, multi-selects all become possible. Mermaid diagrams in Copilot Chat are built on it.
> - Question-carousel (text / single-select / multi-select inline in chat) shipped behind `chatParticipantAdditions` in **Feb 2026** (VS Code 1.99). Use this if you only need form-style input and don't want a webview.
> - **Proposed API is unpublishable**: any extension that uses `enabledApiProposals` cannot be released to the Marketplace. So custom-UI-in-chat is currently **insiders / dogfood / GitHub Copilot-team only**.

---

## 1. Stable Chat Participant API

Defined entirely in [`vscode.d.ts` lines 19594-20120](https://github.com/microsoft/vscode/blob/5c4d9a275639b6ad7b2dad7192c07a5f2112c185/src/vscode-dts/vscode.d.ts#L19594-L20120). Public docs: <https://code.visualstudio.com/api/extension-guides/chat>.

### 1.1 Lifecycle

```ts
// Registration
const participant = vscode.chat.createChatParticipant(
  'my-ext.myParticipant',           // must match contributes.chatParticipants[].id
  async (request, context, stream, token): Promise<vscode.ChatResult | void> => {
    // Handle the request
  },
);
participant.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');
participant.followupProvider = { provideFollowups(result, ctx, tok) { ... } };
participant.onDidReceiveFeedback(e => { /* thumbs up/down */ });
```

| Concept | Type | Source |
|---|---|---|
| `ChatRequestHandler` | `(request, context, stream, token) => ProviderResult<ChatResult \| void>` | [vscode.d.ts#L19777](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19777) |
| `ChatRequest` | `{ prompt, command?, references, toolReferences, toolInvocationToken, model }` | [vscode.d.ts#L19850-L19898](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19850-L19898) |
| `ChatContext` | `{ history: ReadonlyArray<ChatRequestTurn \| ChatResponseTurn> }` | [vscode.d.ts#L19666](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19666) |
| `ChatResult` | `{ errorDetails?, metadata? }` (JSON-serializable) | [vscode.d.ts#L19691](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19691) |

**`package.json` contribution** (declarative; required for slash commands and pretty UI):

```jsonc
"contributes": {
  "chatParticipants": [{
    "id": "my-ext.myParticipant",
    "fullName": "AKS Helper",
    "name": "aks",
    "description": "Help with Azure Kubernetes Service",
    "isSticky": true,
    "commands": [
      { "name": "diagnose", "description": "Diagnose cluster issues" }
    ]
  }]
}
```

### 1.2 ChatResponseStream — stable methods

[`vscode.d.ts#L19905-L19967`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19905-L19967):

```ts
interface ChatResponseStream {
  markdown(value: string | MarkdownString): void;
  anchor(value: Uri | Location, title?: string): void;       // inline link/symbol link
  button(command: Command): void;                             // command-invoking button
  filetree(value: ChatResponseFileTree[], baseUri: Uri): void;
  progress(value: string): void;                              // ephemeral spinner+text
  reference(value: Uri | Location, iconPath?: IconPath): void; // "References" footer chip
  push(part: ChatResponsePart): void;                         // generic
}
type ChatResponsePart =
  | ChatResponseMarkdownPart
  | ChatResponseFileTreePart
  | ChatResponseAnchorPart
  | ChatResponseProgressPart
  | ChatResponseReferencePart
  | ChatResponseCommandButtonPart;
```

### 1.3 Slash commands, followups, history

- **Slash commands** are declared in `package.json#contributes.chatParticipants[].commands` (not via API). They surface in the picker; at runtime `request.command` carries the selected name.
- **Followups**: `participant.followupProvider.provideFollowups(result, context, token)` returns `ChatFollowup[]` rendered as clickable suggestion chips after each turn. ([vscode.d.ts#L19737-L19772](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19737-L19772))
- **History** is `context.history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>`. Crucially `ChatResponseTurn.response` is **only** typed as `ChatResponseMarkdownPart | ChatResponseFileTreePart | ChatResponseAnchorPart | ChatResponseCommandButtonPart` ([vscode.d.ts#L19640](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19640)) — proposed parts (tool-invocations, custom-rendered output, confirmations) are **not** included in stable history.

### 1.4 Stable-API limitations on UI rendering

| Want to render inline | Stable? |
|---|---|
| Markdown (incl. images via `![]()`, code blocks with language hints) | ✅ |
| Clickable links to files / symbols | ✅ (`anchor`) |
| Buttons that fire `vscode.commands.executeCommand` | ✅ (`button`) |
| File tree with diff/preview | ✅ (`filetree`) |
| Spinner + status line | ✅ (`progress`, but only string) |
| Confirmation prompt ("Run? Yes/No") | ❌ proposed only |
| Forms / multi-select / radio inputs | ❌ proposed only (`questionCarousel`) |
| Tables with sorting, charts, flame graphs, custom React | ❌ requires `chatOutputRenderer` (proposed) |
| HTML / iframe / `<script>` inside response | ❌ not supported in any API; webviews only via `chatOutputRenderer` |
| Custom diff or multi-diff editor | ❌ proposed (`ChatResponseMultiDiffPart`) |
| Tool-invocation card with collapsible input/output | ❌ proposed (`ChatToolInvocationPart`) |

**Key finding**: `MarkdownString` in chat **does not honor `isTrusted`** ([line 19911 explicitly says so](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19911)). HTML in markdown is sanitized; you cannot inject `<style>`, `<script>`, or arbitrary tags. Code blocks render with VS Code syntax highlighting + the standard "Apply / Insert / Copy" toolbar (which fires `ChatApplyAction` / `ChatInsertAction` / `ChatCopyAction` on `onDidPerformAction`, see proposed `chatParticipantAdditions`).

---

## 2. Proposed / Insiders APIs (chat surface)

### Index — every chat-related proposal as of 2026-05-04

| File | Lines | Purpose |
|---|---|---|
| [`chatOutputRenderer`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatOutputRenderer.d.ts) | 101 | **★ Custom webview UI inline in chat (mime-typed renderers)** |
| [`chatParticipantAdditions`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts) v3 | 1089 | Extra response parts: confirmation, question-carousel, multi-diff, tool-invocation cards, codeblockUri, code-citation, thinking, vulnerabilities |
| [`chatParticipantPrivate`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatParticipantPrivate.d.ts) v15 | 459 | Internal: `ChatLocation`, request `id`/`sessionResource`, `createDynamicChatParticipant`, participant detection, error confirmations, expected/quota errors |
| [`chatProvider`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatProvider.d.ts) v5 | 163 | Contribute *your own* language model behind a provider (`registerLanguageModelChatProvider` exists in stable but the rich `LanguageModelChatProvider` shape is here) |
| [`chatSessionsProvider`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts) | 781 | Bring whole external chat sessions (Copilot Workspace, GitHub Coding Agent style); render in native chat UI |
| [`chatSessionCustomizationProvider`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatSessionCustomizationProvider.d.ts) | 186 | Customize session header / metadata |
| [`chatStatusItem`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatStatusItem.d.ts) | 61 | Status row above chat input (`window.createChatStatusItem`) |
| [`chatInputNotification`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatInputNotification.d.ts) | 118 | Banners above chat input (info/warn/error + actions) |
| [`chatTab`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatTab.d.ts) | 17 | `TabInputChat` lets you detect a chat tab |
| [`chatContextProvider`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatContextProvider.d.ts) | 221 | Provide workspace / explicit / per-resource attachable context items |
| [`chatHooks`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatHooks.d.ts) v6 | 126 | Lifecycle scripts (SessionStart, PreToolUse, …) |
| [`chatPromptFiles`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatPromptFiles.d.ts) | 500 | `.prompt.md` / `.instructions.md` / `.chatmode.md` discovery |
| [`chatDebug`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatDebug.d.ts) | 828 | Debug-aware chat APIs |
| [`chatReferenceBinaryData` / `chatReferenceDiagnostic`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatReferenceBinaryData.d.ts) | small | Allow bytes / diagnostics as reference values |
| [`defaultChatParticipant`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.defaultChatParticipant.d.ts) v4 | 42 | `ChatTitleProvider`, `ChatSummarizer`, welcome message, helpText prefix/postfix (only one default participant per workspace) |
| [`languageModel*`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/) (Pricing, Capabilities, ThinkingPart, Proxy, System, ToolResultAudience, ToolSupportsModel) | various | Extensions to the LM API |
| [`mcpServerDefinitions` / `mcpToolDefinitions`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.mcpServerDefinitions.d.ts) | 88/98 | Programmatically contribute MCP servers + their tool catalogs |
| [`toolProgress`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.toolProgress.d.ts) | 25 | Streaming `Progress<ToolProgressStep>` from `LanguageModelTool.invoke` |
| [`toolInvocationApproveCombination`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.toolInvocationApproveCombination.d.ts) | 31 | Approve-combos (e.g. "Always allow `npm test`") |
| [`contribLanguageModelToolSets`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.contribLanguageModelToolSets.d.ts) | 6 | Bundle related tools as a "tool set" |

### 2.1 ★ `chatOutputRenderer` — webview content INSIDE chat

This is the answer to "can extensions render React/HTML/charts in the chat panel?" **Yes — via this proposal.**

**Full signature** (file is only 101 lines, [vscode.proposed.chatOutputRenderer.d.ts](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatOutputRenderer.d.ts)):

```ts
export interface ChatOutputDataItem {
  readonly mime: string;
  readonly value: Uint8Array;
}
export interface ChatOutputWebview {
  readonly webview: Webview;        // ← real VS Code webview, full HTML/JS/CSS
  readonly onDidDispose: Event<void>;
}
export interface ChatOutputRenderer {
  renderChatOutput(
    data: ChatOutputDataItem,
    webview: ChatOutputWebview,
    ctx: {},
    token: CancellationToken
  ): Thenable<void>;
}
export namespace chat {
  export function registerChatOutputRenderer(
    viewType: string,
    renderer: ChatOutputRenderer
  ): Disposable;
}
```

**`package.json` contribution**:

```jsonc
"enabledApiProposals": ["chatOutputRenderer"],
"contributes": {
  "chatOutputRenderer": [{
    "viewType": "myExt.flameGraph",
    "mimeTypes": ["application/vnd.myext.flame-graph"]
  }]
}
```

**How the data gets into the renderer** — only path today is **tool calls**. From `chatParticipantAdditions` ([line 25-30](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts#L25-L30)):

```ts
export interface ExtendedLanguageModelToolResult2 extends ExtendedLanguageModelToolResult {
  toolResultDetails2?: Array<Uri | Location> | ToolResultDataOutput;
}
export interface ToolResultDataOutput {
  mime: string;
  value: Uint8Array;   // ← matched to renderer by mime type
}
```

So the flow is:
1. LM decides to call your `LanguageModelTool` (e.g. `getFlameGraph`).
2. Your tool returns a `LanguageModelToolResult` with `toolResultDetails2 = { mime: 'application/vnd.myext.flame-graph', value: bytes }`.
3. VS Code looks up your registered renderer by mime, creates a webview iframe inline in the chat bubble, calls `renderChatOutput(data, webview, …)`.
4. You set `webview.html`, load scripts, post messages — full webview API, **including `webview.options.localResourceRoots`, CSP nonces, `acquireVsCodeApi()` for messaging, etc.**

**Working sample** (Mermaid in chat): [microsoft/vscode-extension-samples/chat-output-renderer-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-output-renderer-sample). Renderer code:

```ts
vscode.chat.registerChatOutputRenderer(viewType, {
  async renderChatOutput({value}, webview, _ctx, _token) {
    const mermaidSource = new TextDecoder().decode(value);
    webview.options = { enableScripts: true, localResourceRoots: [mermaidDist] };
    const nonce = getNonce();
    webview.html = `<!DOCTYPE html>...<pre class="mermaid">${escape(mermaidSource)}</pre>
      <script type="module" nonce="${nonce}">
        import mermaid from '${mermaidEsmUri}';
        mermaid.initialize({ startOnLoad: true });
      </script>...`;
  },
}));
```

**Tracking issues / status**:
- API proposal: [microsoft/vscode#255000 (merged Jul 2025)](https://github.com/microsoft/vscode/pull/255000)
- Umbrella: [microsoft/vscode#257761 — Allow extensions to contribute custom widgets to chat responses](https://github.com/microsoft/vscode/issues/257761) — currently **On Deck** milestone (deferred from Jan 2026 → 1.112 → On Deck on Mar 10, 2026). Not yet finalized; still proposed-only.
- Recent bug: [#267461 — webview disappears on scroll](https://github.com/microsoft/vscode/issues/267461) (fixed Feb 2026).

**Use cases explicitly listed** in #257761: charts and diagrams, interactive data, live HTML previews, interactive widgets / advanced UI. **This is exactly the surface area you'd want for a "custom chat UI" replacement.**

### 2.2 `chatParticipantAdditions` — the giant grab-bag

Version 3, 1089 lines. Adds a *lot* of `ChatResponse*Part` classes and corresponding `ChatResponseStream` methods. Key additions:

```ts
interface ChatResponseStream {
  // Markdown variants
  markdownWithVulnerabilities(value, vulnerabilities: ChatVulnerability[]): void;
  codeblockUri(uri: Uri, isEdit?: boolean): void;

  // Edits (drives the "Edit Mode" / agent UI)
  textEdit(target: Uri, edits: TextEdit | TextEdit[]): void;
  notebookEdit(target: Uri, edits: NotebookEdit | NotebookEdit[]): void;
  workspaceEdit(edits: ChatWorkspaceFileEdit[]): void;        // create/delete/rename
  externalEdit(target: Uri | Uri[], cb: () => Thenable<unknown>): Thenable<string>;

  // Status / progress
  progress(value, task?): void;                                // overrides stable
  thinkingProgress(delta: ThinkingDelta): void;                // streaming "thinking…" UI
  warning(message): void;
  info(message): void;

  // References (richer)
  reference2(value, iconPath?, options?: { status: ... }): void;
  codeCitation(value: Uri, license: string, snippet: string): void;

  // Interactive
  confirmation(title, message, data, buttons?): void;          // ↩ shows "Continue"/"Cancel"; data echoes back as request.acceptedConfirmationData
  questionCarousel(questions: ChatQuestion[], allowSkip?): Thenable<Record<string, unknown> | undefined>;

  // Tools (for participants that orchestrate tools manually)
  beginToolInvocation(toolCallId, toolName, streamData?): void;
  updateToolInvocation(toolCallId, streamData): void;
  clearToPreviousToolInvocation(reason): void;

  // Telemetry / usage
  usage(usage: ChatResultUsage): void;                         // token-usage breakdown
}
```

#### `confirmation(...)` — inline yes/no

```ts
stream.confirmation('Apply patch?',
  'This will modify 3 files in your workspace.',
  { kind: 'applyPatch', patchId: 'p_42' },
  ['Apply', 'Cancel']);
```
On the next request, `request.acceptedConfirmationData` or `request.rejectedConfirmationData` carries the `data` back. ([line 715-725](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts#L715-L725))

#### `questionCarousel` — inline forms (text / single-select / multi-select)

Shipped Feb 2026 ([microsoft/vscode#289568](https://github.com/microsoft/vscode/pull/289568)). Replaces the QuickPick approach with inline UI:

```ts
const answers = await stream.questionCarousel([
  new vscode.ChatQuestion('cluster', vscode.ChatQuestionType.SingleSelect,
    'Which cluster?', {
      options: [
        { id: 'dev', label: 'aks-dev', value: 'dev', /* default: true */ },
        { id: 'prod', label: 'aks-prod', value: 'prod' },
      ],
      defaultValue: 'dev',
    }),
  new vscode.ChatQuestion('namespaces', vscode.ChatQuestionType.MultiSelect,
    'Pick namespaces', { options: [...], allowFreeformInput: true }),
  new vscode.ChatQuestion('reason', vscode.ChatQuestionType.Text,
    'Why?', { message: 'Free-form context for the LM' }),
], /* allowSkip */ true);
// answers === { cluster: 'prod', namespaces: ['default','kube-system'], reason: '...' }
```

**This is a blocking call** — the promise resolves when the user clicks Submit (or `undefined` on Skip All). UI: carousel with Prev/Next + "1 of 3" indicator + Submit/Skip All buttons. Now uses QuickPick-style list selection for both single- and multi-select (changed Jan 28 2026, [#291328](https://github.com/microsoft/vscode/issues/291328)).

Used by Copilot Chat's built-in `askQuestions` tool ([vscode-copilot-chat#3157](https://github.com/microsoft/vscode-copilot-chat/pull/3157)).

#### `ChatToolInvocationPart` — the rich tool-card UI

[Line 339-358](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts#L339-L358):

```ts
class ChatToolInvocationPart {
  toolName: string;
  toolCallId: string;
  isError?: boolean;
  invocationMessage?: string | MarkdownString;       // "Running ${tool}…"
  pastTenseMessage?: string | MarkdownString;        // "Ran ${tool}"
  isComplete?: boolean;
  toolSpecificData?:
    | ChatTerminalToolInvocationData    // command line + output + exit code (renders the terminal card)
    | ChatMcpToolInvocationData         // MCP input/output blob list
    | ChatTodoToolInvocationData        // ✅ todo-list with statuses (the "todo tool")
    | ChatSimpleToolResultData          // collapsible input/output sections
    | ChatToolResourcesInvocationData   // collapsible URI list
    | ChatSubagentToolInvocationData;   // sub-agent invocation card
  presentation?: 'hidden' | 'hiddenAfterComplete';
  enablePartialUpdate?: boolean;
}
```
This is what creates the collapsible terminal cards, the todo-list pane, and the sub-agent cards you see in current Copilot Chat (Feb 2026+). **Strictly proposed.**

#### `ChatResponseMultiDiffPart`, `ChatResponseExtensionsPart`, `ChatResponsePullRequestPart`

- `multiDiff` — inline multi-file diff editor with title and read-only flag.
- `extensions` — display "Install these extensions" card (`new ChatResponseExtensionsPart(['ms-azuretools.vscode-aks-tools'])`).
- `pullRequest` — render a PR card (used by the GitHub Pull Requests extension to surface PRs in chat answers).

### 2.3 `chatParticipantPrivate` — VS Code-internal extras

Version 15. Most relevant fields:

- `ChatRequest.id`, `ChatRequest.sessionResource: Uri`, `ChatRequest.attempt`, `ChatRequest.location: ChatLocation` (Panel/Terminal/Notebook/Editor inline chat).
- `ChatRequestEditorData` / `ChatRequestNotebookData` — inline-chat context: editor, document, selection. Lets you build a participant that runs in the inline-chat or notebook-cell-chat surfaces.
- `chat.createDynamicChatParticipant(id, props, handler)` — register a participant **without** declaring it in package.json (used for runtime-discovered agents).
- `ChatParticipantDetectionProvider` — let VS Code auto-pick your participant from a free-form prompt (the "intent detection" feature).
- `ChatErrorDetails.confirmationButtons` — show `[Retry] [Open settings]` style buttons attached to an error result.
- `window.activeChatPanelSessionResource: Uri | undefined` + change event — finally lets extensions know which chat session is foregrounded.

### 2.4 `chatSessionsProvider` — own the entire chat (not just participate)

781 lines. Use this when you want to surface a **completely external chat backend** (think: Copilot Coding Agent, Codex, your own remote agent) as a first-class chat session inside VS Code, with the native rendering UI. Highlights:

- `chat.createChatSessionItemController(type, refreshHandler)` — owns a list of session items shown in the chat sidebar.
- `chat.registerChatSessionContentProvider(scheme, provider, defaultParticipant, capabilities?)` — for a session URI of `scheme:`, you provide a `ChatSession` containing `history`, an `activeResponseCallback(stream, token)` to stream the live response, and a `requestHandler` for new prompts.
- `ChatSessionInputState` + `ChatSessionProviderOptionGroup` — declare custom pickers above the chat input (e.g. "model", "subagent", "permissions").
- The chat input area can have option groups with `slashCommand` aliases — so `/model gpt-4o` toggles a setting without sending a chat turn.
- `ChatSessionCapabilities.supportsInterruptions` — declares whether the session can pause/resume safely.

**Used in production** by GitHub's Copilot Coding Agent integration.

### 2.5 `chatStatusItem` — status row above chat input

```ts
const item = vscode.window.createChatStatusItem('aks-cluster-status');
item.title = { label: 'Connected to aks-prod', link: 'command:aks.changeCluster' };
item.description = 'Region: westus2 · v1.30.5';
item.detail = '$(warning) 2 deprecated APIs detected';
item.show();
```
Renders just above the chat input box. Persistent, not part of any single response.

### 2.6 `chatInputNotification` — banner above chat input

`window.createChatStatusItem` is for steady state; `chat.createInputNotification` is for transient warnings (quota close, model deprecation) with severity (Info / Warning / Error), action buttons, dismiss, autoDismissOnMessage flags.

### 2.7 `chatHooks` — lifecycle scripts

```ts
type ChatHookType = 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit'
  | 'PreToolUse' | 'PostToolUse' | 'PreCompact'
  | 'SubagentStart' | 'SubagentStop' | 'Stop' | 'ErrorOccurred';
```
User configures shell commands per hook. They can return `'success' | 'error' | 'warning'` and stop the agent. New `stream.hookProgress(...)` and `ChatResponseHookPart` render their results inline.

### 2.8 `chatContextProvider` — attachable context

Three flavors:
- `ChatWorkspaceContextProvider.provideWorkspaceChatContext()` — auto-attached to every request (use sparingly).
- `ChatExplicitContextProvider.provideExplicitChatContext()` — items shown when user clicks **Attach Context** (paperclip).
- `ChatResourceContextProvider.provideResourceChatContext({ resource })` — implicit context for a particular open resource (driven by `chat.implicitContext.suggestedContext`).

`ChatContextItem` = `{ icon?, label?, resourceUri?, modelDescription?, tooltip?, value?, command? }`. Lazy `value` resolution via `resolveChatContext`.

---

## 3. Custom output rendering — the FULL menu

| Capability | API | Stable? |
|---|---|---|
| Custom HTML/JS/CSS inline in chat (charts, flame graphs, react widgets) | `chatOutputRenderer` (mime-typed webview, fed by tool calls) | **Proposed** (since 1.103, Jul 2025) |
| Multi-select / radio / text form inline in chat | `ChatResponseStream.questionCarousel` | **Proposed** (since 1.99, Feb 2026) |
| Inline yes/no confirmation | `ChatResponseStream.confirmation` | Proposed |
| Tool-invocation card (terminal, MCP, todo, sub-agent) | `ChatToolInvocationPart` w/ `toolSpecificData` | Proposed |
| Multi-file diff editor inline | `ChatResponseMultiDiffPart` | Proposed |
| Mermaid / diagrams in chat (Copilot built-in) | `chatOutputRenderer` + Mermaid sample | Proposed |
| **Tables** | Markdown tables (rendered, but not interactive) | Stable |
| Interactive sortable tables, charts | Only via `chatOutputRenderer` | Proposed |
| File tree | `stream.filetree(...)` | Stable |
| Buttons | `stream.button(Command)` or `stream.confirmation(..., buttons)` | Stable / Proposed |

### 3.1 How real extensions do it today

- **Mermaid in Copilot Chat** → built-in feature using `chatOutputRenderer` ([vscode-extension-samples/chat-output-renderer-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-output-renderer-sample)).
- **GitHub Pull Requests extension** → uses `ChatResponsePullRequestPart` (proposed) to render PR cards. Search [microsoft/vscode-pull-request-github](https://github.com/microsoft/vscode-pull-request-github) for `enabledApiProposals`.
- **Python extension / Jupyter** → primarily use stable markdown + tool-calling. Notebook-targeted edits use `notebookEdit` (proposed). They do **not** ship custom inline UI in the public chat panel as of May 2026.
- **Copilot Coding Agent / Workspace** → uses `chatSessionsProvider` to bring a remote session into VS Code with native rendering.
- **Copilot's `askQuestions` tool** → uses `questionCarousel` (proposed).
- **Copilot's todo tool** → uses `ChatToolInvocationPart` with `ChatTodoToolInvocationData`.

### 3.2 The webview-in-chat capability — what works, what doesn't

✅ Full `Webview` API: `enableScripts`, `localResourceRoots`, `cspSource`, `asWebviewUri`, `postMessage` ↔ `acquireVsCodeApi`, `onDidReceiveMessage`.
✅ Persistent across history scroll **once #267461 fixes are picked up** (Feb 2026).
✅ Theming via CSS variables (same as any VS Code webview).
✅ Multiple renderers per extension (one `viewType` per mime).
⚠️ Webview lifecycle is owned by VS Code — you cannot resize the bubble freely; the renderer must respect chat layout. Internal API for getting webview content size: [#256802](https://github.com/microsoft/vscode/pull/256802).
❌ No way today to push a webview without going through a tool result blob.
❌ No way to emit custom output from the participant handler directly (the tool-result blob path is the only ingress; this may relax later — see #257761 "We may allow other sources … letting participants generate it directly or having it come from MCP server").
❌ Extension **cannot ship to the Marketplace** while consuming `chatOutputRenderer` (proposed-API restriction). It's insiders-only / dogfood.

---

## 4. Language Model API (`vscode.lm`)

Stable since VS Code 1.90 (May 2024). Surface in [`vscode.d.ts#L20122-L21232`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L20122-L21232).

### 4.1 Sending requests to Copilot models

```ts
const [model] = await vscode.lm.selectChatModels({
  vendor: 'copilot', family: 'gpt-4o',
});
const messages = [
  vscode.LanguageModelChatMessage.User('You are an AKS expert.'),
  vscode.LanguageModelChatMessage.User(request.prompt),
];
const response = await model.sendRequest(messages, {
  toolMode: vscode.LanguageModelChatToolMode.Auto,
  tools: vscode.lm.tools.map(t => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
  })),
}, token);

for await (const chunk of response.stream) {
  if (chunk instanceof vscode.LanguageModelTextPart) {
    stream.markdown(chunk.value);
  } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
    const result = await vscode.lm.invokeTool(chunk.name, {
      toolInvocationToken: request.toolInvocationToken,  // ← critical: shows in chat UI
      input: chunk.input,
    }, token);
    // feed result back as User message with LanguageModelToolResultPart...
  }
}
```

Key types ([line 20140-21010](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L20140-L21010)):

| Class | Purpose |
|---|---|
| `LanguageModelChatMessage.User(content, name?)` / `.Assistant(...)` | Construct messages |
| `LanguageModelTextPart` | Text content |
| `LanguageModelToolCallPart` | LM-emitted tool call |
| `LanguageModelToolResultPart` | Tool result fed back to LM (in a User msg) |
| `LanguageModelDataPart.{image,json,text}` | Multi-modal content (images, JSON blobs) |
| `LanguageModelPromptTsxPart` | Result of `@vscode/prompt-tsx` `renderElementJSON` |
| `LanguageModelToolResult` | Wrap content parts |

### 4.2 Tool calling — `LanguageModelTool`

Declare in `package.json`:

```jsonc
"contributes": {
  "languageModelTools": [{
    "name": "aks_listClusters",
    "displayName": "List AKS Clusters",
    "modelDescription": "Lists AKS clusters in the user's subscriptions.",
    "userDescription": "List your AKS clusters",
    "canBeReferencedInPrompt": true,                  // makes #aks_listClusters work
    "toolReferenceName": "listClusters",
    "icon": "$(azure)",
    "inputSchema": { "type": "object", "properties": { ... } },
    "tags": ["aks", "azure"]
  }]
}
```

Implement:

```ts
class ListClustersTool implements vscode.LanguageModelTool<{ subscriptionId: string }> {
  async prepareInvocation(opts, token) {
    return {
      invocationMessage: `Listing clusters in ${opts.input.subscriptionId}…`,
      // For dangerous tools:
      confirmationMessages: { title: 'Run kubectl?', message: '...' },
    };
  }
  async invoke(opts, token) {
    const clusters = await ...;
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(clusters)),
    ]);
  }
}
vscode.lm.registerTool('aks_listClusters', new ListClustersTool());
```

### 4.3 How tools interact with chat participants

When you call `lm.invokeTool(name, options)`:
- **With `toolInvocationToken: request.toolInvocationToken`** → progress bar + confirmation prompt (if any) appear inline in the chat panel automatically. The user sees the tool card.
- **Without it** (e.g. background flow) → only confirmations show; otherwise silent.

If you want **custom UI for the tool invocation**, your options:
1. Stable: rely on auto-rendered progress + `prepareInvocation.invocationMessage` (markdown, but limited).
2. Proposed `toolProgress` — `invoke(opts, token, progress: Progress<ToolProgressStep>)` lets the tool stream `{ message, increment }` updates that render as a progress bar with text.
3. Proposed `chatOutputRenderer` — return `toolResultDetails2: { mime, value }` → custom webview card.
4. Proposed `ChatToolInvocationPart` with `toolSpecificData` — pre-canned card layouts (terminal, todo, MCP, sub-agent).

### 4.4 Returning your own model — `registerLanguageModelChatProvider`

Stable function (line 20845), full surface in [`chatProvider.d.ts`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.proposed.chatProvider.d.ts). You can publish a vendor (e.g. `'aks'`) that exposes models in `lm.selectChatModels` and even gates them to a particular `chatSessions` type via `targetChatSessionType`.

### 4.5 Other LM proposals (May 2026)

| Proposal | Adds |
|---|---|
| `languageModelThinkingPart` | Reasoning/thinking tokens stream as a separate part type (opt-in for o1/Claude-style models) |
| `languageModelPricing` | Per-model `inputTokenPrice`, `outputTokenPrice`, `cacheReadDiscount` etc. for cost UI |
| `languageModelCapabilities` | Image input, vision, audio capability flags |
| `languageModelToolResultAudience` | Tag tool result parts with `'user' \| 'assistant' \| 'both'` (control what LM sees vs what user sees) |
| `languageModelToolSupportsModel` | Tools advertise compatibility with specific models |
| `languageModelProxy` | Stand up a localhost proxy for another extension to consume LM access without re-implementing auth |
| `languageModelSystem` | Mark messages as system role (currently only User/Assistant in stable) |

---

## 5. Recent demos / blog posts / release notes (Nov 2024 → May 2026)

### 5.1 Release-note milestones for chat

| Release | Date | Chat UI feature |
|---|---|---|
| 1.85+ | Late 2024 | Chat Participant API stable surface finalized |
| 1.95-1.97 | Q4 2025 | `chatParticipantAdditions` v1-v2: confirmation, multi-diff, edit parts |
| **1.103** | **Jul 2025** | **`chatOutputRenderer` proposed (PR #255000); Mermaid diagrams demo'd** |
| 1.104 | Sep 2025 | `chatOutputRenderer` history-rendering bug surfaces (#267461) |
| 1.97-1.99 | Q4 2025 / Jan 2026 | `ChatToolInvocationPart` with `toolSpecificData` (terminal, todo, MCP cards) |
| **1.99** | **Feb 2026** | **`questionCarousel` shipped (PR #289568); replaces QuickPicks for tool questions** |
| 1.100 | Mar 2026 | Question-carousel UI moved from radios/checkboxes to QuickPick-style list (#291328); freeform-input fallback added |
| 1.111 | Apr 2026 | `chatOutputRenderer` history fix landed (Feb 3 closed) |
| HEAD | May 4 2026 | `chatOutputRenderer` still **proposed**, milestone: **On Deck** |

### 5.2 Key external resources

- 📘 Official guide: <https://code.visualstudio.com/api/extension-guides/chat>
- 📘 Tool calling: <https://code.visualstudio.com/api/extension-guides/tools>
- 📘 Language Model API: <https://code.visualstudio.com/api/extension-guides/language-model>
- 📦 Sample: chat-output-renderer (Mermaid): <https://github.com/microsoft/vscode-extension-samples/tree/main/chat-output-renderer-sample>
- 📦 Sample: chat (basic participant): <https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample>
- 📦 Sample: chat-tools-sample: <https://github.com/microsoft/vscode-extension-samples/tree/main/chat-tools-sample>
- 🐛 Custom widgets umbrella: <https://github.com/microsoft/vscode/issues/257761>
- 🐛 Question carousel test plan: <https://github.com/microsoft/vscode/issues/290633>
- 📦 GitHub Copilot Chat (consumer of all proposals): <https://github.com/microsoft/vscode-copilot-chat> (`enabledApiProposals` in its package.json shows everything currently dogfooded)

### 5.3 The "flame graph in chat" pattern

This is precisely the use case `chatOutputRenderer` was designed for. The recipe (insiders-only):
1. Register a tool `aks_profile` that returns flame-graph JSON as `toolResultDetails2: { mime: 'application/vnd.aks.flame', value: bytesOfJSON }`.
2. Register a renderer for `'application/vnd.aks.flame'` with `viewType: 'aks.flameGraph'`.
3. In the renderer, set `webview.html` to bundle d3-flame-graph (or your favorite React app) and decode the bytes.
4. The LM, when asked "profile pod X", picks the tool, gets the bytes, and the chat bubble shows your interactive flame graph.

---

## 6. Decision matrix — Custom Chat UI vs Chat Participant API

| Concern | Chat Participant API (stable) | Chat Participant + `chatOutputRenderer` (proposed) | Custom chat webview (your own view) |
|---|---|---|---|
| Marketplace publishable | ✅ | ❌ (proposed-API gate) | ✅ |
| Native @-mention discovery in Copilot Chat | ✅ | ✅ | ❌ |
| Render arbitrary HTML/React/charts | ❌ | ✅ via webview-per-bubble | ✅ entire panel is yours |
| Slash commands | ✅ | ✅ | manual |
| Tool calling (LM picks tools) | ✅ via `vscode.lm` | ✅ | ✅ via `vscode.lm` |
| User auth, telemetry, history | inherits Copilot's | inherits Copilot's | DIY |
| Form inputs (multi-select etc.) | ❌ (need confirm/markdown hacks) | ✅ `questionCarousel` (proposed) or full webview | ✅ DIY |
| Inline alongside Copilot's other answers | ✅ | ✅ | ❌ separate view |
| Persists across reload | ✅ history | ✅ (post-Feb 2026 fix) | DIY |
| Effort | Low | Medium (proposed-API setup + tool-result blob plumbing + insiders-only build) | High (entire UI + LM plumbing) |
| Future-proofing risk | Low | Medium (`chatOutputRenderer` shape may still change — currently version 1, "On Deck") | Low |

---

## 7. Concrete artifacts to produce next

For your kickstart-plan you can lift these verbatim:

1. **Stable participant skeleton** — see §1.1.
2. **`chatOutputRenderer` POC checklist**:
   - `enabledApiProposals: ["chatOutputRenderer", "chatParticipantAdditions"]`
   - `engines.vscode: "^1.103.0"`
   - Run with `code --enable-proposed-api <publisher>.<name>` (insiders or stable VS Code).
   - Build a tool that returns `toolResultDetails2 = { mime, value }`.
   - Register renderer with matching `viewType` + mime.
3. **`questionCarousel` POC** — only needs `chatParticipantAdditions` proposed; no webview wiring.
4. **Risk register**:
   - All proposed APIs may change shape between releases (see `// version: 15` comments).
   - `chatOutputRenderer` is "On Deck" in the milestone tracker as of Mar 10 2026 — no committed finalization date.
   - You cannot ship to Marketplace with proposed APIs ⇒ if customers need this on stable VS Code Stable, plan for a custom-view fallback.
