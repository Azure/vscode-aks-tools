## How to Release

To make a new release and publish it to the marketplace you have to follow the following steps.

1. Create a branch `publish-x.y.z`
2. Update `package.json` with the new version
3. Refresh the pinned third-party versions (see [Pinned third-party versions](#pinned-third-party-versions) below)
4. Add a section to `CHANGELOG.md` with the header `## [x.y.z]` (N.B: make sure to write the new version in square brackets as the `changelog-reader` action only works if the `CHANGELOG.md` file follows the [Keep a Changelog standard](https://github.com/olivierlacan/keep-a-changelog))
5. Create a new PR, get approval and merge
6. Run the `Build & Publish` workflow manually from the GH Actions tab

### Pinned third-party versions

Two independent sets of external versions are baked into this extension. Both drift silently between releases and should be reviewed each cut.

#### CLI binaries downloaded on demand

Defaults live in `package.json` under `contributes.configuration`. `azure.kubelogin.releaseTag` is the single source of truth for both the locally-downloaded kubelogin AND the `kubelogin-version` input in every generated GitHub Actions workflow — `workflowTemplate.ts` substitutes the setting value at generation time.

| Setting | Upstream repo | Consumed by |
|---|---|---|
| `azure.kubelogin.releaseTag` | [Azure/kubelogin](https://github.com/Azure/kubelogin/releases) | Local CLI download **and** substituted into generated workflows as `kubelogin-version` |
| `azure.kubectlgadget.releaseTag` | [inspektor-gadget/inspektor-gadget](https://github.com/inspektor-gadget/inspektor-gadget/releases) | Local `kubectl-gadget` download |
| `aks.drafttool.releaseTag` | [Azure/draft](https://github.com/Azure/draft/releases) | Local Draft binary download (skip tags with no uploaded assets — Draft occasionally publishes a tag before its assets) |
| `aks.retinatool.releaseTag` | [microsoft/retina](https://github.com/microsoft/retina/releases) | Local `kubectl-retina` download |
| `aks.aksmcpserver.releaseTag` | [Azure/aks-mcp](https://github.com/Azure/aks-mcp/releases) | Local AKS MCP server binary download |

```sh
for repo in Azure/kubelogin Azure/aks-mcp Azure/draft microsoft/retina inspektor-gadget/inspektor-gadget; do
  echo -n "$repo: "; gh api "repos/$repo/releases/latest" --jq '.tag_name'
done
```

Before bumping, verify the target release actually has uploaded platform assets (`curl -sI` on a representative download URL and expect `HTTP/2 200`).

#### GitHub Actions pinned in workflow templates

The templates under `resources/yaml/*.template.yaml` pin these action majors. Major tags receive minor/patch fixes automatically — bumping is only needed when a new major ships. When bumping, update all template files that reference the action and the corresponding assertions in `src/tests/suite/containerAssist/workflowTemplate.test.ts`.

| Action | Upstream |
|---|---|
| `actions/checkout` | [actions/checkout](https://github.com/actions/checkout/releases) |
| `azure/login` | [Azure/login](https://github.com/Azure/login/releases) |
| `azure/use-kubelogin` | [Azure/use-kubelogin](https://github.com/Azure/use-kubelogin/releases) |
| `azure/aks-set-context` | [Azure/aks-set-context](https://github.com/Azure/aks-set-context/releases) |
| `Azure/k8s-deploy` | [Azure/k8s-deploy](https://github.com/Azure/k8s-deploy/releases) |

```sh
grep -h "uses:" resources/yaml/*.template.yaml | sort -u
for repo in actions/checkout Azure/login Azure/use-kubelogin Azure/aks-set-context Azure/k8s-deploy; do
  echo -n "$repo: "
  gh api "repos/$repo/releases" --jq \
    '[.[] | select(.prerelease==false and .draft==false)] | .[0].tag_name'
done
```

Skim the release notes of the target major before bumping. Recent Azure/* action majors have been pure Node.js runtime bumps (Node 20 → Node 24) and are safe. Watch for renamed/removed inputs or new required inputs.

**Do not bump a version without a smoke test** — generate a workflow via the extension, push it to a real branch on a real AKS cluster, and confirm the run succeeds. Bumping blindly is worse than staying pinned.

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