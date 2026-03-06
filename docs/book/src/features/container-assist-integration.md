# Deploying Apps to AKS with GitHub Actions and Container Assist (Alpha Preview)

> **Please Note**
> This is an **Alpha Preview** feature. Behavior, prompts, and generated output may change between releases.
>
> **AI Notice**
> Container Assist uses AI models to analyze project context and generate deployment files. Always review generated files before use, and do not include secrets or sensitive data in source files used for generation.

Container Assist is a feature-flagged workflow in the AKS VS Code extension that helps generate deployment assets for AKS directly from your project.

## Problem this feature solves

Deploying an application to AKS with a GitHub Actions pipeline usually requires multiple manual steps:

- Creating and tuning a Dockerfile
- Authoring Kubernetes manifests for deployment and service resources
- Creating a CI/CD workflow for build, push, and deploy
- Wiring Azure authentication and repository workflow setup

This process is flexible, but often time-consuming and error-prone, especially when teams are setting up deployment automation for a new or existing project.

## How this feature helps

Container Assist reduces setup friction by guiding you through:

- Repository analysis
- Dockerfile generation
- Kubernetes manifest generation
- Optional GitHub workflow generation
- Optional PR-ready Git staging flow

This gives teams a review-first starting point so they can iterate quickly while keeping full control over the final deployment configuration.

## Feature flag

Enable this preview feature in VS Code settings:

```json
{
  "aks.containerAssistEnabledPreview": true
}
```

Default value: `false`

This can also be enabled from the VS Code Settings UI.

![Container Assist Flag from User Setting](../resources/container-assist/container-assist-user-settings-flag.png)

## Where you can launch it

Container Assist can be launched from:

- Explorer folder context menu: `AKS: Deploy application to AKS (Preview)`
- AKS cluster context menu: `AKS: Run Container Assist (Preview)`

The AKS cluster context menu entry is shown when:

- `aks.containerAssistEnabledPreview` is `true`
- At least one workspace folder is open

## User flow and options

After launch, you can select one or both actions:

- `Generate Deployment Files`
- `Generate GitHub Workflow`

If `Generate Deployment Files` is selected, the flow analyzes your project and generates:

- `Dockerfile` at project root (or selected module path)
- Kubernetes manifests under your configured manifests folder (default: `k8s`)

If `Generate GitHub Workflow` is selected, workflow generation is configured for the selected AKS/Azure context.

If both actions are selected, deployment file generation runs first, then workflow generation.

## GitHub integration story

When generated files are ready, the post-generation flow is designed for PR-friendly collaboration:

1. OIDC setup prompt (when workflow is generated):
   - `Setup OIDC`
   - `Skip`
2. Review prompt:
   - `Stage & Review`
   - `Open Files`
3. If you choose staging, files are staged and Source Control is focused with a suggested commit message.
4. After commit, you are prompted to create a pull request.
5. PR creation can run through the GitHub Pull Requests extension, with default branch and draft behavior from settings.

This supports a full path from local generation to reviewable GitHub PR with minimal manual glue steps.

## Configuration reference

`aks.containerAssistEnabledPreview`
: Enable/disable the Container Assist preview entry points.

`aks.containerAssist.k8sManifestFolder`
: Folder name for generated Kubernetes manifests. Default: `k8s`.

`aks.containerAssist.enableGitHubIntegration`
: Enables Git/GitHub integration in the post-generation flow.

`aks.containerAssist.promptForPullRequest`
: Reserved setting for PR prompting behavior.

`aks.containerAssist.prDefaultBranch`
: Default base branch for PRs. Default: `main`.

`aks.containerAssist.prCreateAsDraft`
: Create PRs as draft by default. Default: `true`.

`aks.containerAssist.modelFamily`
: Default model family used by Container Assist. Default: `gpt-5.2-codex`.

`aks.containerAssist.modelVendor`
: Default model vendor used by Container Assist. Default: `copilot`.

## Screenshots

### Menu entry points

![Container Assist from workspace explorer menu](../resources/container-assist/container-assist-workspacemenu.png)

![Container Assist from AKS cluster menu](../resources/container-assist/container-assist-commands-1.png)

### Container Assist and GitHub integration flow

![Container Assist flow step 2](../resources/container-assist/container-assist-commands-2.png)

![Container Assist flow step 3](../resources/container-assist/container-assist-commands-3.png)

![Container Assist flow step 4](../resources/container-assist/container-assist-commands-4.png)

![Container Assist flow step 5](../resources/container-assist/container-assist-commands-5.png)

![Container Assist flow step 6](../resources/container-assist/container-assist-commands-6.png)

![Container Assist flow step 7](../resources/container-assist/container-assist-commands-7.png)

![Container Assist flow step 8](../resources/container-assist/container-assist-commands-8.png)

![Container Assist flow step 9](../resources/container-assist/container-assist-commands-9.png)

![Container Assist flow step 10](../resources/container-assist/container-assist-commands-10.png)

![Container Assist flow step 11](../resources/container-assist/container-assist-commands-11.png)

![Container Assist flow step 12](../resources/container-assist/container-assist-commands-12.png)

![Container Assist flow step 13](../resources/container-assist/container-assist-commands-13.png)

![Container Assist flow step 14](../resources/container-assist/container-assist-commands-14.png)

![Container Assist flow step 15](../resources/container-assist/container-assist-commands-15.png)
