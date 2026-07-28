# **Containerization Assist Skills for Copilot Chat (Preview)**

## **Overview**

The Containerization Assist (CA) skills are five agent skills that expose containerization capabilities directly inside GitHub Copilot chat, so users can containerize a workload and deploy it to AKS through a chat-first workflow. The skills are packaged from the [`containerization-assist-mcp`](https://www.npmjs.com/package/containerization-assist-mcp) npm dependency and shipped inside this extension — no separate MCP server, tool install, or extension is required.

Contributed skills (via `contributes.chatSkills`):

- **`analyze-repo`** — inspect the workspace and infer language, framework, and containerization needs.
- **`generate-dockerfile`** — produce a Dockerfile grounded in analyze-repo output and CA's Dockerfile knowledge base.
- **`fix-dockerfile`** — validate an existing Dockerfile and apply fixes against CA's policy set.
- **`generate-k8s-manifests`** — produce Kubernetes manifests (deployment, service, configmap) with production-safe defaults.
- **`deploy-to-aks`** — orchestrate the full analyze → generate → build → push → apply → verify loop against an AKS cluster.

The skills are a **Preview feature** and are available by default when the AKS extension is installed.

## **Motivation**

CA already ships as a standalone MCP server that any editor can consume. Contributing the same skills through the AKS extension delivers three things that the standalone MCP server alone does not:

1. **Zero setup for AKS users.** CA's containerization knowledge — Dockerfile generation, policy-driven fixes, K8s manifest generation, and the AKS deploy loop — becomes available the moment the AKS extension is installed. Users do not need to install a second extension, register an MCP server, or manage a separate process.
2. **Chat-first workflow.** The existing Container Assist features in this extension (enabled via `aks.containerAssistEnabledPreview`) are command- and panel-driven. The CA skills complement those by exposing the same underlying capabilities inside Copilot chat as agentic slash-command flows — better suited to iterative, conversational work.
3. **A single AKS surface for containerization + deploy.** Combined with the [Kickstart agent](./kickstart-agent.md), the AKS extension can now guide a user from an uncontainerized workspace to a running deployment on AKS entirely from chat, using one consistent set of AKS-specific defaults.

## **Availability**

The five CA skills are included and registered automatically. No feature flag or additional setup is required. The `aks.containerAssistEnabledPreview` setting controls the separate command-based Container Assist flows, while `aks.kickstartEnabledPreview` controls the [Kickstart agent](./kickstart-agent.md) and its supporting skills.

## **How the Skills Are Packaged**

At build time, [`webpack.config.js`](../../../../webpack.config.js) copies `node_modules/containerization-assist-mcp/skills/` into `dist/skills/`. Each of the five entries in `contributes.chatSkills` points at `./dist/skills/<name>/SKILL.md`, so the packaged extension ships the skill definitions directly and stays in sync with the CA version pinned in [`package.json`](../../../../package.json).

## **Related Documentation**

- [Use Container Assist (Preview)](./container-assist-integration.md) — the command-based Container Assist experience (separate preview flag).
- [Kickstart Agent for AKS Automatic (Preview)](./kickstart-agent.md) — the AKS Automatic onboarding chat agent.
