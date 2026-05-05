# Kickstart: App Containerization and Deployment (Preview)

Kickstart helps you containerize your applications and deploy them to Azure Kubernetes Service (AKS) through a guided experience in VS Code. It uses AI to analyze your project and generate the necessary Docker and Kubernetes configuration files.

## Overview

Kickstart streamlines the process of moving from source code to a running application on AKS. It provides both a chat-based interface and a webview-driven walkthrough to help you:
- Analyze your project for containerization.
- Generate a `Dockerfile` tailored to your application.
- Create Kubernetes manifests (Deployment, Service) for AKS.
- Configure Azure resources like Azure Container Registry (ACR) and AKS clusters.
- Build and push images to ACR.
- Deploy your application to AKS.

## Enabling the preview

Kickstart is currently a preview feature. To enable it, add the following setting to your VS Code `settings.json`:

```json
{
  "aks.kickstartEnabledPreview": true
}
```

## Entry points

You can start the Kickstart flow in three ways:
1. **Chat:** Type `@kickstart` in the GitHub Copilot Chat panel.
2. **Command Palette:** Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and search for `AKS: Kickstart Containerization`.
3. **AKS Tree View:** Right-click on an AKS cluster in the Azure extension tree view and select `Kickstart Containerization`.

## Webview walkthrough

The Kickstart webview guides you through the configuration process:
1. **Azure Context:** Select your Subscription, Resource Group, and AKS Cluster.
2. **Container Registry:** Choose an existing Azure Container Registry (ACR) or create a new one.
3. **Permission Checks:** The tool checks if the AKS cluster has the `AcrPull` role on the selected ACR. If not, it provides an **Attach** button to automatically configure the ACR-cluster attachment.
4. **Start Generation:** Click **Start** to begin the project analysis and file generation.

<!-- screenshot -->

## Chat walkthrough

The `@kickstart` chat participant provides an interactive way to use the feature:
- **Welcome Message:** When you first invoke `@kickstart`, it presents a welcome message with quick-start buttons.
- **Interactive Flow:** You can use `/start` to begin the containerization of your current workspace.
- **Sample Projects:** Use `/sample` to quickly explore Kickstart with a known project.

## Slash commands

Kickstart supports the following slash commands in chat:
- `/start`: Begins the containerization process for the current workspace.
- `/sample`: Clones the [aks-store-demo](https://github.com/Azure-Samples/aks-store-demo) sample repository to a temporary location and opens it in a new window so you can see Kickstart in action.

## Save flow

Once Kickstart generates the suggested files, you can review them before saving:
- **Per-file Save:** Click the **Save** button next to individual files (e.g., `Dockerfile`, `deployment.yaml`).
- **Save All:** Use the **Save all** button to save all generated files at once.
- **Overwrite Confirmation:** If a file already exists, Kickstart will ask for confirmation before overwriting it.

## Build/Deploy follow-ups

After saving your files, Kickstart provides next steps to get your app running:
- **Build & push to ACR:** This opens a terminal and runs `az acr build`, using the generated `Dockerfile` and your selected ACR.
- **Deploy to AKS:** This uses `kubectl apply` (or the existing deployment plugin) to deploy the generated manifests to your AKS cluster.

## Telemetry

Kickstart collects minimal telemetry to improve the feature:
- Command invocations (how often the feature is used).
- Success and failure flags for the generation process.
- No user source code or sensitive content is ever collected.

## Limitations

As a preview feature, Kickstart has some limitations:
- **Supported Languages:** Optimized for Node.js, Python, .NET, and Go.
- **Requirements:** Requires the GitHub Copilot extension to be installed and signed in.
- **Sample Flow:** Using the `/sample` command triggers a window reload to open the cloned repository.

## FAQ

**Why does the window reload after "Use a sample"?**
The sample command clones a repository to a local path and opens that folder as a new workspace in VS Code, which requires a window reload.

**What if my language isn't supported?**
Kickstart will still attempt to analyze the project, but the accuracy of the generated `Dockerfile` and manifests may be lower. You can always manually edit the generated files.

**How do I file a bug?**
Please report issues on our [GitHub repository](https://github.com/Azure/vscode-aks-tools/issues) with the "kickstart" label.
