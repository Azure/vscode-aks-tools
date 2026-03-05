# Container Assist Integration (Preview)

Container Assist is a feature-flagged workflow in the AKS VS Code extension that helps generate deployment assets for AKS directly from your project.

## Why this was added

Container Assist reduces setup time by guiding you through:

- Repository analysis
- Dockerfile generation
- Kubernetes manifest generation
- Optional GitHub workflow generation
- Optional PR-ready Git staging flow

## Feature flag

Enable this preview feature in VS Code settings:

```json
{
  "aks.containerAssistEnabledPreview": true
}
```

Default value: `false`

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

## Screenshot placeholders

Add screenshots under `docs/book/src/resources/` and then replace the placeholder notes below.

Placeholder 1:
- Suggested file: `container-assist-cluster-menu.png`
- Context: AKS cluster right-click menu showing `AKS: Run Container Assist (Preview)`

Placeholder 2:
- Suggested file: `container-assist-action-picker.png`
- Context: Multi-select action picker (`Generate Deployment Files`, `Generate GitHub Workflow`)

Placeholder 3:
- Suggested file: `container-assist-stage-review.png`
- Context: Post-generation `Stage & Review` notification and SCM handoff

Placeholder 4:
- Suggested file: `container-assist-pr-flow.png`
- Context: PR creation prompt flow after commit
