# AKS Extension — Copilot Chat Integration Kickstart Plan

**Audience:** maintainers of [`vscode-aks-tools`](https://github.com/Azure/vscode-aks-tools) (currently `^1.110.0`, ships its own Vite/React `webview-ui/`).
**Date:** 2026-05-04
**Source of truth:** [`microsoft/vscode@5c4d9a27`](https://github.com/microsoft/vscode/tree/5c4d9a275639b6ad7b2dad7192c07a5f2112c185/src/vscode-dts) (HEAD on research date).

---

## 1. Goal

Decide how this extension integrates with GitHub Copilot Chat. Specifically:

- Should we register a **Chat Participant** (`@aks`) and stream responses into the existing Copilot Chat panel, or build our **own chat UI** in a webview view?
- How do we surface **rich UI elements** (cluster pickers, resource graphs, flame-graph-style visualizations, multi-select forms) that the maintainers saw demo'd?
- What ships to the Marketplace **today** vs what is insiders-only / proposed-API?

---

## 2. TL;DR — Recommended architecture

> **Build a stable `@aks` Chat Participant + ship rich UI as MCP Apps.** Use existing webview panels as a fallback for full-screen surfaces. Reserve `chatOutputRenderer` for insiders-only previews.

```
┌────────────────────────────────────────────────────────────────────────┐
│  GitHub Copilot Chat panel (host)                                      │
│                                                                        │
│   @aks  «user prompt»                                                  │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │  AKS Chat Participant (vscode.chat.createChatParticipant)    │    │
│   │  STABLE — vscode-aks-tools owns the handler                  │    │
│   │  • stream.markdown()  ← explanations, kubectl YAML            │    │
│   │  • stream.button()    ← "Open cluster", "Run diagnose"        │    │
│   │  • stream.anchor()    ← portal links, manifest links          │    │
│   │  • stream.filetree()  ← generated Helm chart preview          │    │
│   │  • stream.reference() ← context badges                        │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │  Language Model Tools (vscode.lm.registerTool)               │    │
│   │  STABLE — agent auto-invokes; user can #aks_get_clusters      │    │
│   │   aks_list_clusters · aks_describe_pod · aks_get_logs · ...   │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │  AKS MCP Server (separate process, bundled with extension)   │    │
│   │  STABLE in VS Code 1.113 — also works in Claude/Cursor/ChatGPT│   │
│   │  Returns MCP Apps (ui:// resources) for:                      │    │
│   │    • Cluster picker widget                                    │    │
│   │    • Resource graph / topology diagram                        │    │
│   │    • Multi-select node/pod form                               │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│   Fallback for full-screen surfaces:                                   │
│   stream.button({ command: 'aks.openClusterExplorer' })                │
│      → existing webview-ui panel                                       │
└────────────────────────────────────────────────────────────────────────┘
```

**Why this combination:**

| Concern | Solution |
|---|---|
| Marketplace publishable today | ✅ All four blocks above are stable APIs |
| Rich UI (graphs, multi-select, pickers) | ✅ MCP Apps (sandboxed iframe, bidirectional postMessage, theme-aware) |
| Cross-host reusability | ✅ MCP server also works in Claude Desktop, Cursor, ChatGPT |
| Uses user's Copilot quota (no API keys) | ✅ Chat participant uses `vscode.lm.*` |
| Natural UX (`@aks` mention) | ✅ Lives inside the existing Copilot Chat panel |
| Existing investment in `webview-ui/` | ✅ Reused as fallback for full-screen experiences |

---

## 3. The four real options (and why we picked this hybrid)

| # | Approach | API | Status | Marketplace? | Verdict |
|---|---|---|---|---|---|
| **A** | **Chat Participant + ChatResponseStream** | `vscode.chat.createChatParticipant` | **Stable** | ✅ | **Use** as the conversational shell |
| **B** | **chatOutputRenderer** (webview inline in chat bubble) | `vscode.proposed.chatOutputRenderer` | Proposed (1.109+) | ❌ VSIX-only | **Skip for v1.** Revisit when stable. |
| **C** | **MCP Apps** (interactive UI returned by MCP tools) | MCP `ui://` resources, mime `text/html;profile=mcp-app` | **Stable** in VS Code 1.113 (Mar 25, 2026) | ✅ (it's an MCP server, not an extension API) | **Use** for rich AKS widgets |
| **D** | **Standalone webview view** (own chat UI, Continue/Cline style) | `registerWebviewViewProvider` | Stable | ✅ | Skip — duplicates Copilot UX, requires BYO model keys, loses `@`/`#` ecosystem |

### Why not "build our own chat UI" (option D)?

Continue.dev and Cline do this, and it works, but the trade-offs are bad for an Azure-branded extension:

- We lose the user's existing **Copilot subscription / quota** — would have to BYO API keys or call Azure OpenAI ourselves.
- We lose free integration with `#file`, `#codebase`, `#terminalSelection`, MCP servers, and other chat participants.
- We have to reimplement streaming, theming, syntax highlighting, history persistence, and accessibility — Continue's webview is ~thousands of lines just for that scaffolding.
- Users have to learn a second chat surface ("AKS Chat" vs "Copilot Chat").

The **only** reason to choose D is if we need a UX so divergent from Copilot Chat that the participant constraints are blocking — which is not the case for AKS conversations.

### Why not `chatOutputRenderer` for v1 (option B)?

It is the *future* answer for "render React inline in a Copilot Chat bubble" — full webview per response, theme-aware, fed via `LanguageModelTool` results. The official Mermaid sample ([`microsoft/vscode-extension-samples/chat-output-renderer-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-output-renderer-sample)) shows the exact pattern.

**Blockers today:**

- `enabledApiProposals` ⇒ **cannot publish to the Marketplace**. VSIX-only.
- Off-screen webviews in chat history are disposed (memory optimization) — only the most recent card may render when scrolling. Tracked in [vscode#257761](https://github.com/microsoft/vscode/issues/257761).
- Tied to the tool-calling flow (data must come from a `LanguageModelTool`'s `toolResultDetails2`); no direct invocation from a chat participant yet.
- Mar 10, 2026 milestone status: "On Deck" — not yet committed to a stable release.

**Plan:** design any custom widget as a self-contained HTML+JS bundle so the **same bundle** can later be registered for `chatOutputRenderer` once it stabilizes. Until then ship via MCP Apps.

### What about the "flame graph in chat" demo?

That was **MCP Apps**, not `chatOutputRenderer`. Announced [Jan 26, 2026 on the VS Code blog](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support); reference repo [`digitarald/mcp-apps-playground`](https://github.com/digitarald/mcp-apps-playground) contains the literal `flame_graph`, `list_sort`, and `feature_flags` tools. Microsoft's own [`microsoft/mcp-app-servers`](https://github.com/microsoft/mcp-app-servers) ships an Azure Diagram MCP App that is the closest analogue to what we want for AKS.

---

## 4. Stable Chat Participant API — what we can actually do today

### 4.1 Manifest contribution

```jsonc
// package.json
{
  "engines": { "vscode": "^1.110.0" },
  "contributes": {
    "chatParticipants": [{
      "id": "ms-kubernetes-tools.aks",
      "name": "aks",
      "fullName": "Azure Kubernetes Service",
      "description": "Ask about your AKS clusters, pods, and kubectl",
      "isSticky": true,
      "commands": [
        { "name": "diagnose", "description": "Diagnose a cluster issue" },
        { "name": "deploy",   "description": "Deploy a workload to a cluster" },
        { "name": "explain",  "description": "Explain a kubectl resource" }
      ],
      "disambiguation": [{
        "category": "aks",
        "description": "User asks about Azure Kubernetes Service",
        "examples": [
          "Why is my pod crashlooping?",
          "Show me the nodes in cluster prod-eastus",
          "Generate a deployment manifest for an nginx app on AKS"
        ]
      }]
    }],
    "languageModelTools": [
      { "name": "aks_list_clusters",  "displayName": "List AKS clusters",
        "modelDescription": "Lists AKS clusters in the user's subscriptions.",
        "canBeReferencedInPrompt": true, "toolReferenceName": "aks_list_clusters" },
      { "name": "aks_describe_pod",   "displayName": "Describe an AKS pod",
        "modelDescription": "Returns kubectl describe output for a pod.",
        "canBeReferencedInPrompt": true, "toolReferenceName": "aks_describe_pod" },
      { "name": "aks_get_logs",       "displayName": "Get pod logs",
        "modelDescription": "Returns recent log lines from a pod.",
        "canBeReferencedInPrompt": true, "toolReferenceName": "aks_get_logs" }
    ]
  }
}
```

### 4.2 Handler skeleton

```typescript
// src/chat/aksChatParticipant.ts
import * as vscode from 'vscode';

export function registerAksChatParticipant(context: vscode.ExtensionContext) {
  const handler: vscode.ChatRequestHandler = async (request, ctx, stream, token) => {
    stream.progress(vscode.l10n.t('Querying AKS context…'));

    // Pick a model from the user's Copilot subscription
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    if (!model) {
      stream.markdown(vscode.l10n.t('No language model available. Sign in to Copilot.'));
      return;
    }

    // Build messages with our AKS tools enabled
    const tools = vscode.lm.tools.filter(t => t.name.startsWith('aks_'));
    const messages = [
      vscode.LanguageModelChatMessage.User(buildSystemPrompt(request, ctx)),
      vscode.LanguageModelChatMessage.User(request.prompt),
    ];
    const response = await model.sendRequest(messages, { tools }, token);

    // Stream markdown + handle tool-calls in a loop (see chat-sample for full helper)
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        stream.markdown(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        // dispatch to vscode.lm.invokeTool, append result, re-call model
      }
    }

    // Surface useful follow-up actions
    stream.button({
      command: 'aks.openClusterExplorer',
      title: vscode.l10n.t('Open Cluster Explorer'),
    });
    return { metadata: { command: request.command } };
  };

  const participant = vscode.chat.createChatParticipant('ms-kubernetes-tools.aks', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'aks-tools.png');
  participant.followupProvider = {
    provideFollowups(result) {
      return [
        { label: vscode.l10n.t('List my clusters'),  prompt: 'List my AKS clusters' },
        { label: vscode.l10n.t('Diagnose an issue'), prompt: '/diagnose ', command: 'diagnose' },
      ];
    },
  };
  context.subscriptions.push(participant);
}
```

### 4.3 What the stable `ChatResponseStream` lets us emit

| Method | What it renders | AKS use |
|---|---|---|
| `stream.markdown(MarkdownString)` | Markdown + code blocks (no `<script>`, `isTrusted` **ignored**) | Explanations, generated YAML, kubectl examples |
| `stream.button({command,title,arguments})` | Action button bound to a VS Code command | "Open cluster in portal", "Run diagnose", "Apply manifest" |
| `stream.anchor(uriOrLocation, title?)` | Inline link to file / symbol / external URI | Link to a `deployment.yaml`, an Azure portal URL |
| `stream.reference(uriOrLocation)` | "Used as context" pill in sidebar | List manifests / cluster state used in the answer |
| `stream.filetree(items, baseUri)` | Interactive file tree | Show generated Helm chart structure |
| `stream.progress(string)` | Italic progress message | "Querying ARM…", "Fetching pod logs…" |

**That is the entire stable surface.** No HTML, no forms, no charts, no multi-select, no confirmation dialogs. Anything richer than this requires either MCP Apps (today, marketplace-OK) or `chatOutputRenderer` (proposed, VSIX-only).

> Reference: [`vscode.d.ts` lines 19594–21232](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19594) (Chat + LM API).
> `MarkdownString.isTrusted` not honored: [`vscode.d.ts#L19911`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19911).

---

## 5. Rich UI — MCP Apps (the recommended path)

> **This is how we ship "cluster picker", "resource graph", "flame-graph-style hot-pod viewer", "multi-select node form" today, in the Marketplace, and have it work in Claude Desktop / Cursor / ChatGPT for free.**

### 5.1 The shape

An MCP server is a separate Node process. When the LLM calls a tool, the server returns:

1. A normal `content` array (text the LLM sees).
2. A `structuredContent` blob (delivered to the UI without bloating the LLM context).
3. A `_meta.ui.resourceUri` pointing to a `ui://…` resource that hosts the HTML.

The Copilot Chat host renders the UI in a **sandboxed iframe** inside the chat bubble, with bidirectional `ui/message` JSON-RPC for postMessage-style communication.

```typescript
// aks-mcp-server/src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'aks-mcp', version: '0.1.0' });

server.resource(
  'cluster-picker-ui',
  'ui://aks-mcp/cluster-picker',
  { mimeType: 'text/html;profile=mcp-app' },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/html;profile=mcp-app',
      text: CLUSTER_PICKER_HTML,   // self-contained HTML+JS bundle
    }],
  })
);

server.registerTool('aks_pick_cluster', {
  description: 'Show an interactive picker for the user to choose an AKS cluster.',
  inputSchema: { subscriptionId: z.string().optional() },
  _meta: {
    ui: { resourceUri: 'ui://aks-mcp/cluster-picker', visibility: ['model', 'app'] },
  },
}, async ({ subscriptionId }) => {
  const clusters = await listClusters(subscriptionId);
  return {
    content: [{ type: 'text', text: `${clusters.length} clusters available.` }],
    structuredContent: { clusters }, // delivered to the iframe
  };
});
```

The iframe receives `structuredContent` via the MCP App protocol, renders the picker, and posts back the user's selection — which the host turns into a follow-up tool call or appends to the chat transcript.

### 5.2 Bundling with `vscode-aks-tools`

We have two options:

1. **Bundled MCP server** — ship the server as a Node script inside the extension; register it programmatically via the (proposed but stabilizing) `vscode.lm.registerMcpServerProvider`, or auto-write a `mcp.json` entry on activation.
2. **Standalone npm package** — publish `@azure/aks-mcp` separately so non-VS-Code MCP hosts (Claude Desktop, Cursor) can install it directly. Mirror what [`Azure/azure-mcp`](https://github.com/Azure/azure-mcp) does.

Recommendation: **do both** — ship the same code as both a bundled VS Code MCP server (zero-config for our users) and a published npm package (broader reach).

### 5.3 Why this fits AKS perfectly

- Microsoft's [`microsoft/mcp-app-servers`](https://github.com/microsoft/mcp-app-servers) already ships an **Azure Diagram** MCP App — it is the direct analogue of an "AKS resource graph" widget.
- [`Azure/azure-mcp`](https://github.com/Azure/azure-mcp) is the headless-tools counterpart from the same org. We slot in next to it.
- MCP Apps are theme-aware and a11y-respectful by host contract.
- Stable, marketplace-OK, cross-host.

---

## 6. The "for completeness" appendix — `chatOutputRenderer`

We are **not** using this in v1, but engineers should know what it is so we can plan for the day it goes stable.

```jsonc
// package.json (insiders / VSIX only)
{
  "enabledApiProposals": ["chatOutputRenderer"],
  "contributes": {
    "languageModelTools": [{
      "name": "aks_render_topology",
      "canBeReferencedInPrompt": true,
      "modelDescription": "Renders an interactive AKS topology graph."
    }],
    "chatOutputRenderers": [{
      "viewType": "ms-kubernetes-tools.aks.topology",
      "mimeTypes": ["application/vnd.aks.topology+json"]
    }]
  }
}
```

```typescript
// 1. The LanguageModelTool returns typed binary in toolResultDetails2
const result = new vscode.LanguageModelToolResult([
  new vscode.LanguageModelTextPart('Topology computed.'),
]);
result.toolResultDetails2 = {
  mime: 'application/vnd.aks.topology+json',
  value: new TextEncoder().encode(JSON.stringify(topology)),
};
return result;

// 2. The renderer turns it into a webview inline in the chat bubble
vscode.chat.registerChatOutputRenderer('ms-kubernetes-tools.aks.topology', {
  async renderChatOutput({ value }, chatOutputWebview) {
    chatOutputWebview.webview.options = { enableScripts: true, localResourceRoots: [...] };
    chatOutputWebview.webview.html = buildTopologyHtml(JSON.parse(new TextDecoder().decode(value)));
  },
});
```

> **Design tip:** keep the topology / picker / graph widgets as **self-contained HTML+JS bundles** — the same bundle can be served from MCP Apps today and from `chatOutputRenderer` tomorrow with zero rewrite.

References: [`vscode.proposed.chatOutputRenderer.d.ts`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatOutputRenderer.d.ts) · [`chat-output-renderer-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-output-renderer-sample) · master tracking issue [vscode#257761](https://github.com/microsoft/vscode/issues/257761).

### Other proposed APIs worth knowing

These were reviewed during research (all under [`microsoft/vscode/src/vscode-dts/` @ 5c4d9a27](https://github.com/microsoft/vscode/tree/5c4d9a275639b6ad7b2dad7192c07a5f2112c185/src/vscode-dts)). All proposed = **VSIX-only**.

| Proposal | What it adds | AKS relevance |
|---|---|---|
| `chatParticipantAdditions` (v3) | `confirmation`, `ChatToolInvocationPart`, `ChatResponseMultiDiffPart`, `ChatResponseExtensionsPart`, `ChatResponsePullRequestPart`, `questionCarousel(...)` (Text/SingleSelect/MultiSelect inline form, Feb 2026) | High — `confirmation` for destructive kubectl ops, `questionCarousel` for multi-select node pickers |
| `chatSessionsProvider` | Bring an entire external agent backend into VS Code's chat UI (used by Copilot Coding Agent) | Low — overkill for AKS |
| `chatProvider` (v5) | Provide an entire LLM as if it were Copilot | Not relevant |
| `chatStatusItem` | Custom items in the chat status bar | Nice-to-have |
| `chatContextProvider` | Custom `#aks-context` entries | Medium — could expose `#current-cluster` |
| `defaultChatParticipant` (v4) | Be the *default* participant | Not relevant |
| `mcpServerDefinitions` / `mcpToolDefinitions` | Programmatic MCP server registration | High — how we will register the bundled AKS MCP server without `mcp.json` |
| `languageModelToolResultAudience` | Control whether tool result goes to model, user, or both | Medium |
| `toolProgress` | Progress streaming from `LanguageModelTool.invoke` | Medium |

---

## 7. Phased implementation plan

### Phase 1 — Stable participant + tools (target: 2 weeks)

1. Add `chatParticipants` and `languageModelTools` contributions to [`package.json`](file:///home/azureuser/vscode-aks-tools/package.json).
2. Implement `src/chat/aksChatParticipant.ts` (handler, model selection, tool-call loop).
3. Implement initial `LanguageModelTool` set:
   - `aks_list_clusters`
   - `aks_describe_pod`
   - `aks_get_logs`
   - `aks_get_events`
   - `aks_explain_resource`
4. Hook follow-ups into existing commands (cluster explorer, kubectl run, diagnostics).
5. Reference the official [`chat-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample) for the tool-call streaming helper (`@vscode/chat-extension-utils` exports `sendChatParticipantRequest`).
6. Tests: integration test with `vscode.chat` test surface, snapshot tool schemas.

**Deliverable:** `@aks` works in Copilot Chat, can answer questions and run AKS tools, surfaces follow-up buttons that open existing webview panels.

### Phase 2 — MCP Apps server (target: 3 weeks)

1. New package: `aks-mcp/` (Node, `@modelcontextprotocol/sdk`, Zod).
2. First MCP App: **cluster picker** (`ui://aks-mcp/cluster-picker`). Reuse React components from existing `webview-ui/` where possible.
3. Wire the MCP server bundle into the extension activation path (programmatic registration via `mcpServerDefinitions` proposed API; fall back to `mcp.json` autogen for stable shipping).
4. Second MCP App: **resource graph / topology** (matches the "flame graph in chat" demo shape).
5. Publish `@azure/aks-mcp` to npm so non-VS-Code MCP hosts can use it.

**Deliverable:** rich AKS widgets render inline in Copilot Chat, marketplace-publishable, also works in Claude Desktop and Cursor.

### Phase 3 — Insiders preview with `chatOutputRenderer` (opportunistic)

1. Take the same widget bundles built in Phase 2 and register them under `chatOutputRenderers` in an **insiders-only VSIX**.
2. Use for internal demos / dogfooding.
3. Track [vscode#257761](https://github.com/microsoft/vscode/issues/257761); promote to stable when the API is.

**Deliverable:** internal demo build with native (non-iframe) chat UI; production extension unchanged.

---

## 8. Open questions for the team

1. **Authentication scope** — does the MCP server reuse the extension's existing Azure auth session (via a local IPC), or independently call `DefaultAzureCredential`? (Affects whether the npm-published variant works standalone.)
2. **Telemetry** — chat participant requests carry useful signal (which slash command, did the answer help). Confirm we are okay sending the same telemetry we send today via `aiKey` in `package.json`.
3. **Slash command surface** — start with `/diagnose`, `/deploy`, `/explain`, or smaller? Each command is a discoverability hook.
4. **Widget interaction model** — when the user picks a cluster in the MCP App picker, do we (a) post the selection back as a chat message, (b) silently pin it as `#current-cluster` chat context, or (c) both?
5. **Workspace trust** — chat participants run under workspace trust; confirm our existing `untrustedWorkspaces.supported: true` declaration still makes sense once we are running kubectl on user's behalf from an LLM-driven loop.

---

## 9. Reference index

### Official docs / samples
- [Chat Participant API guide](https://code.visualstudio.com/api/extension-guides/ai/chat)
- [`chat-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample) (stable)
- [`chat-tutorial`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-tutorial)
- [`chat-output-renderer-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-output-renderer-sample) (proposed)
- [MCP Apps blog post (Jan 26, 2026)](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support)

### Reference implementations
- [`microsoft/vscode-copilot-chat`](https://github.com/microsoft/vscode-copilot-chat) — Copilot Chat itself, gold standard for participant patterns
- [`microsoft/vscode/extensions/mermaid-chat-features`](https://github.com/microsoft/vscode/tree/main/extensions/mermaid-chat-features) — built-in chatOutputRenderer
- [`digitarald/mcp-apps-playground`](https://github.com/digitarald/mcp-apps-playground) — `flame_graph`, `list_sort`, `feature_flags` (the demo)
- [`microsoft/mcp-app-servers`](https://github.com/microsoft/mcp-app-servers) — Azure Diagram, Monaco, Aspire Dashboard MCP Apps
- [`Azure/azure-mcp`](https://github.com/Azure/azure-mcp) — sibling Azure MCP server we'll mirror
- [`continuedev/continue`](https://github.com/continuedev/continue/tree/main/extensions/vscode) — webview-chat reference (for Phase-D fallback only)
- [`cline/cline`](https://github.com/cline/cline) — webview-chat reference

### API tracking
- [vscode#257761](https://github.com/microsoft/vscode/issues/257761) — chat output renderer master issue
- [vscode#293060](https://github.com/microsoft/vscode/issues/293060) — request for native (non-iframe) chat components
- Stable Chat + LM API: [`vscode.d.ts#L19594-L21232`](https://github.com/microsoft/vscode/blob/5c4d9a27/src/vscode-dts/vscode.d.ts#L19594)
- Proposed APIs reviewed: `chatOutputRenderer`, `chatParticipantAdditions` (v3), `chatParticipantPrivate` (v15), `chatProvider` (v5), `chatSessionsProvider`, `chatSessionCustomizationProvider`, `chatStatusItem`, `chatInputNotification`, `chatTab`, `chatContextProvider`, `chatHooks` (v6), `chatPromptFiles`, `chatDebug`, `chatReferenceBinaryData`, `chatReferenceDiagnostic`, `defaultChatParticipant` (v4), `languageModelThinkingPart`, `languageModelPricing`, `languageModelCapabilities`, `languageModelToolResultAudience`, `languageModelToolSupportsModel`, `languageModelProxy`, `languageModelSystem`, `mcpServerDefinitions`, `mcpToolDefinitions`, `toolProgress`, `toolInvocationApproveCombination`, `contribLanguageModelToolSets`.
