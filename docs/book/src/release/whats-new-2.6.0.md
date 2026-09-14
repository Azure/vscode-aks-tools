# What's New in 2.6.0

Everything added since `2.5.0`. Full release history is on the
[GitHub Releases](https://github.com/Azure/vscode-aks-tools/releases) page.

## Containerize and deploy from Copilot Chat

Five Containerization Assist skills now ship inside the extension and are available
in Copilot Chat as soon as it is installed — no MCP server to register, no second
extension, no feature flag:

- **`analyze-repo`** works out your workspace's language, framework, and what it needs
  to be containerized.
- **`generate-dockerfile`** writes a Dockerfile based on that analysis.
- **`fix-dockerfile`** checks a Dockerfile you already have and repairs it.
- **`generate-k8s-manifests`** produces a deployment, service, and configmap with
  production-safe defaults.
- **`deploy-to-aks`** runs the whole loop — analyze, generate, build, push, apply,
  verify — against a cluster.

These complement the existing command- and panel-driven Container Assist flows rather
than replacing them, so you can stay in chat when the work is exploratory and switch
to the panels when it isn't.

See [Containerization Assist Skills for Copilot Chat (Preview)](../features/containerization-assist-skills.md).

## Kickstart now works in Azure Cloud Shell

Kickstart assumed a local Docker daemon, which Cloud Shell does not have. In Cloud
Shell it would either stall on a build it could not run or report a check it had never
actually performed.

- **Images are always built with `az acr build`**, server-side on ACR's remote task
  builders. There is one build path, so the image that gets validated is the image that
  gets deployed.
- **Your entry point is verified during the build** via a `RUN test -f` assertion in the
  Dockerfile. A missing entry point now fails the ACR build directly, before a cluster
  even exists.
- **Deployment Safeguards review covers the full policy set**, so the review phase no
  longer passes manifests that the cluster would reject.

See [Kickstart Agent for AKS Automatic (Preview)](../features/kickstart-agent.md).

## Documentation you can trust

The docs had drifted from the extension. This release realigns them and adds checks so
they stay aligned.

- **Commands, settings, and pinned tool versions are now generated from `package.json`**,
  so the reference cannot go stale without CI noticing.
- **Menu paths, navigation, and cross-page links are corrected** — the Development page
  was silently rendering as an empty stub, and three pages under `docs/` were stale
  forks of their published counterparts. The forks are gone; `docs/book/src/` is the
  single source of truth.
- **Factual errors are fixed and stale screenshots removed.** Commands that were never
  reachable are no longer documented as if they were, commands that existed but were
  undocumented now are, and pinned versions are stated rather than implied.
- **`npm run docs:check` and `npm run docs:reference:check`** catch menu/orphan and generated-reference drift
  when run, but are not currently wired into CI.

See [Reference](../reference.md) and [Development](../development.md).

## Compatibility

- **The minimum supported VS Code version is now 1.125.0.** On older versions the
  extension will not install or update. Update VS Code before upgrading.

## Under the hood

- **Archive extraction no longer depends on `decompress`.** That package is unmaintained
  and pulled in a large transitive tree; downloads of the pinned CLIs now use targeted
  extraction instead.
- **Azure SDK clients moved to their current majors** — `arm-resources` 8,
  `arm-resources-subscriptions` 3, `arm-monitor` 8, `arm-compute` 25, and
  `arm-resourcegraph` 5.0.0 GA — along with the usual round of dependency updates across
  the extension and webview.
- **The stale 1ES pipeline definition was removed** from `.github/workflows`; signed
  publishing runs from the internal pipeline only.

## Thanks

Thanks to @benjaminbob21, @bosesuneha, @davidgamero, and @Tatsinnit for contributions,
testing, and reviews.

## Where to go next

- [What the extension can do](../features/features.md)
- [Every command, setting and pinned tool version](../reference.md)
