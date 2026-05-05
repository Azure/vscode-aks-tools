# Decisions

## [2026-05-04] Architecture decisions (from plan)
- Standalone @kickstart participant (NOT @azure function)
- Webview = preflight only; chat owns generation
- Reuse Container Assist SDK + lmClient + prompts by IMPORT (no service refactor)
- Languages v1: Node + Python + .NET + Go + GitHub Actions YAML
- Sample URL: https://github.com/Azure-Samples/aks-store-demo.git
- Preview flag: aks.kickstartEnabledPreview (default false)
- LM model: request.model first, lmClient.ensureModel() fallback
- Multi-root: showWorkspaceFolderPick
- Cancellation: request.token propagated to all SDK calls
- Telemetry: chat.kickstart.* (chat) vs kickstart.* (webview)
- Participant icon: resources/aks-tools.png
- isSticky: true
- "ACR attached" = AcrPull role assignment presence (no separate ManagedCluster field)
- Cluster with both SP and kubelet identity → prefer kubelet identity
- Build & push command launches `az acr build` only in a VS Code terminal; the extension does not invoke ACR builds directly.
