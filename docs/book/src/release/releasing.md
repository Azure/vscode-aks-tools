## How to Release

To make a new release and publish it to the marketplace you have to follow the following steps.

1. Create a branch `publish-x.y.z`
2. Update `package.json` with the new version
3. Refresh the pinned third-party tool versions (see [Pinned tool versions](#pinned-tool-versions) below)
4. Add a section to `CHANGELOG.md` with the header `## [x.y.z]` (N.B: make sure to write the new version in square brackets as the `changelog-reader` action only works if the `CHANGELOG.md` file follows the [Keep a Changelog standard](https://github.com/olivierlacan/keep-a-changelog))
5. Create a new PR, get approval and merge
6. Run the `Build & Publish` workflow manually from the GH Actions tab

### Pinned tool versions

The extension pins the versions of several third-party CLIs that it downloads or embeds in generated GitHub Actions workflows. Each release, verify these are still current and bump the `default` in `package.json` `contributes.configuration` if there is a newer stable release with matching platform assets (Linux/macOS/Windows amd64 + arm64).

| Setting | Upstream repo | Consumed by |
|---|---|---|
| `azure.kubelogin.releaseTag` | [Azure/kubelogin](https://github.com/Azure/kubelogin/releases) | Local CLI download **and** substituted into generated workflows as `kubelogin-version` — the two must stay in sync (single source of truth is the setting default) |
| `azure.kubectlgadget.releaseTag` | [inspektor-gadget/inspektor-gadget](https://github.com/inspektor-gadget/inspektor-gadget/releases) | Local `kubectl-gadget` download |
| `aks.drafttool.releaseTag` | [Azure/draft](https://github.com/Azure/draft/releases) | Local Draft binary download (skip release tags that have no uploaded assets — Draft occasionally publishes a tag before its assets) |
| `aks.retinatool.releaseTag` | [microsoft/retina](https://github.com/microsoft/retina/releases) | Local `kubectl-retina` download |
| `aks.aksmcpserver.releaseTag` | [Azure/aks-mcp](https://github.com/Azure/aks-mcp/releases) | Local AKS MCP server binary download |

Quick check from a shell (requires `gh` auth):

```sh
for repo in Azure/kubelogin Azure/aks-mcp Azure/draft microsoft/retina inspektor-gadget/inspektor-gadget; do
  echo -n "$repo: "; gh api "repos/$repo/releases/latest" --jq '.tag_name'
done
```

If you bump `azure.kubelogin.releaseTag`, also update `KUBELOGIN_FALLBACK_VERSION` in `src/commands/aksContainerAssist/workflowTemplate.ts` so unit tests that don't boot the VS Code config still render a matching version.

### Build & Publish 

The `Build & Publish` workflow allows to create a new release, package it in a VSIX file and publish to the VSCode marketplace with a single click.

The only requirement needed to run the workflow is to have a secret named `VS_MARKETPLACE_TOKEN` containing the Personal Access Token of the publisher. You can find more infos about how to create a publisher/token in the [official documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#create-a-publisher)

Once everything is set up and you followed all first 4 steps in the previous section, you are ready to trigger the `Build & Publish` workflow.
This is what it actually does:

1. Install all dependencies and build the project
2. Check if the `CHANGELOG.md` contains a section related to the new version
3. Create a new release
4. Create the VSIX file and publish it to the marketplace
5. Attach the VSIX file to the new release