# **Kickstart Agent for AKS Automatic (Preview)**

## **Overview**

The **Kickstart** agent is an AI-guided onboarding experience that deploys a containerized application to **AKS Automatic** end-to-end, contributed as a VS Code chat agent. It is designed for users who want to ship an app to AKS without deep Kubernetes expertise — Kickstart walks through discovery, infrastructure configuration, design, artifact generation, review, and deploy as a single conversational flow.

Kickstart is a **Preview feature** and is gated behind a setting.

## **Enabling the Feature**

> **💡 Important Note:**
> Kickstart is disabled by default. To enable it, add the following line to your user `settings.json` file:
>
> ```json
> "aks.kickstartEnabledPreview": true
> ```
>
> You can open this file by pressing `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS), selecting **Preferences: Open Settings (JSON)**, and adding the setting within the top-level JSON object. Reload the window after changing the setting.
>
> The same flag also gates:
> - The `kickstart` and `kickstart-reviewer` chat agents (contributed via `contributes.chatAgents`).
> - The 19 kickstart phase and domain skills used by the agent (contributed via `contributes.chatSkills`).
> - The two Kickstart commands listed below.

## **Features**

### **Launch the Kickstart Agent**

> Starts the guided AKS Automatic onboarding flow. Available from the Command Palette or by selecting `kickstart` in the Copilot chat agent picker.

Command: **AKS: Launch Kickstart Agent** (`aks.kickstart.launchExperience`)

The agent walks through seven sequential phases:

1. **Discover** — understand the app (language, dependencies, ports, environment variables) and map each service.
2. **Configure Infrastructure** — create new or select existing Azure resources (resource group, AKS Automatic cluster, ACR).
3. **Design** — propose the target architecture and confirm with the user.
4. **Generate** — create Dockerfile(s), Kubernetes manifests, Bicep, and a GitHub Actions workflow.
5. **Review** — hand off to the internal `kickstart-reviewer` agent to validate every artifact against a security + AKS Automatic compliance checklist.
6. **Pre-Deploy Check** — verify the cluster is ready and ACR is attached.
7. **Deploy** — build, push, apply, and health-check the running app.

### **Configure a Kickstart Cluster**

> Provisions or updates an AKS Automatic cluster suitable for Kickstart deploys, without going through the full agent flow.

Command: **AKS: Configure Kickstart Cluster** (`aks.kickstartCluster`)

## **Related Documentation**

- The Kickstart agent and its skills live under [`agents/`](../../../../agents/) and [`skills/`](../../../../skills/) in this repository.
- Kickstart hands generated artifacts off to `kickstart-reviewer` for validation before deploy — this handoff is internal and not user-invocable.
