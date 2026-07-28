---
name: vscode-aks-tools-release-pr
description: "Prepare a release PR for the Azure/vscode-aks-tools VS Code extension. Bumps version in package.json and package-lock.json, creates a new What's New doc, updates SUMMARY.md / release.md / README.md / releasing.md, and removes stale prior-release files. WHEN: 'make a release PR', 'release vscode-aks-tools', 'bump extension version', 'create publish-x.y.z branch', 'prepare release notes for aks tools', 'what's new file for next release'. DO NOT USE FOR: actually publishing to the marketplace (that runs via the internal 1ES pipeline), changelog backfill (CHANGELOG.md is deprecated since 1.6.14), or unrelated repos."
argument-hint: "Target version (e.g., 2.1.0). Optionally describe release highlights."
---

# vscode-aks-tools Release PR

Prepare a `publish-x.y.z` release PR for the [Azure/vscode-aks-tools](https://github.com/Azure/vscode-aks-tools) VS Code extension.

This skill ONLY prepares the source changes needed for the release PR. The actual marketplace publish is handled by the internal 1ES signed pipeline (`.github/workflows/1es-pipeline.yml`) — do not attempt to run it.

## When to Use

- User asks to cut/prepare/start a new release of the AKS VS Code extension
- User says "bump the version to X.Y.Z" for this repo
- User asks to draft the What's New doc for the next release
- User wants to open a `publish-x.y.z` PR

## When NOT to Use

- Marketplace publishing (handled by internal 1ES pipeline)
- Updating `CHANGELOG.md` — deprecated since 1.6.14; release notes now live in GitHub Releases + the What's New doc
- Any repo other than `Azure/vscode-aks-tools`

## Inputs

Gather (ask the user if not provided):

1. **Target version** (semver `x.y.z`, e.g. `2.1.0`).
2. **Release highlights** — optional. By default the What's New doc is generated from PRs merged into `upstream/main` since the previous release tag (see step 6). The user may override or augment that list.
3. **Whether to remove the previous What's New file** — default YES (only the current release's file is kept).

## Procedure

### 1. Verify Repo and Working State

```bash
git rev-parse --show-toplevel    # must end in /vscode-aks-tools (or a worktree of it)
git remote -v                    # confirm `upstream` points to Azure/vscode-aks-tools
git status --short               # must be clean
```

If not clean, stop and ask the user.

### 2. Establish the Release Branch

Per `docs/book/src/release/releasing.md`, the convention is `publish-x.y.z`.

```bash
git fetch upstream main
git checkout -b publish-<x.y.z> upstream/main
```

If the user already created a branch and is on it, skip this step.

### 3. Identify Current and Previous Versions

- **Current version**: read `"version"` from root `package.json`.
- **Previous What's New file**: `ls docs/book/src/release/whats-new-*.md`. There should normally be exactly one.

### 4. Bump Version in `package.json` and `package-lock.json`

Use `npm version` to update both files atomically (no git tag, no commit):

```bash
npm version <x.y.z> --no-git-tag-version --allow-same-version
```

This updates:
- root `package.json` → `"version"`
- root `package-lock.json` → top-level `"version"` AND `packages."".version`

Do NOT run `npm install` (we are not changing dependencies and do not want lockfile churn). If `npm version` is unavailable, edit the three fields manually.

`webview-ui/package.json` is marked `"private": true` with version `"0.0.0"` — do NOT bump it.

### 5. Audit Other Version References

Run this audit and report findings to the user before changing anything beyond the files in step 4:

```bash
# Search for the OLD version as a project version (not a dependency range)
grep -rn --include='*.json' --include='*.ts' --include='*.md' --include='*.yml' --include='*.yaml' \
  -e "\"version\": \"<old-version>\"" \
  -e "vscode-aks-tools.*<old-version>" \
  .
```

Expected hits (must update):
- `package.json` (line ~5)
- `package-lock.json` (root + `packages.""`)

Known false positives (do NOT touch):
- `.vscode/tasks.json` — `"version": "2.0.0"` is the tasks file schema version
- Any `"@azure/*"` dependency versions
- Any `node` / `engines` fields

If any hit doesn't fit the above, surface it to the user before editing.

### 5b. Audit Pinned Third-Party Versions

Independently of the extension's own version, the extension pins the versions of five external CLIs (downloaded on demand) and five GitHub Actions (baked into generated workflow templates). These drift silently between releases. Review them each cut and bump the defaults if a newer stable release exists with a matching platform-asset matrix.

#### 5b.1. Downloaded CLI binaries

Defaults live in `package.json` under `contributes.configuration`. `azure.kubelogin.releaseTag` is special: `workflowTemplate.ts` also substitutes its value into every generated workflow's `azure/use-kubelogin` step, so **the setting default IS the single source of truth** for both the local CLI and the CI kubelogin. No separate template value.

```bash
for repo in Azure/kubelogin Azure/aks-mcp Azure/draft microsoft/retina inspektor-gadget/inspektor-gadget; do
  echo -n "$repo: "; gh api "repos/$repo/releases/latest" --jq '.tag_name'
done
```

Compare against current `package.json` defaults:

| Setting | Upstream |
|---|---|
| `azure.kubelogin.releaseTag` | Azure/kubelogin |
| `azure.kubectlgadget.releaseTag` | inspektor-gadget/inspektor-gadget |
| `aks.drafttool.releaseTag` | Azure/draft |
| `aks.retinatool.releaseTag` | microsoft/retina |
| `aks.aksmcpserver.releaseTag` | Azure/aks-mcp |

**Before bumping, verify the target release actually has uploaded platform assets** (Linux/macOS/Windows amd64 + arm64). Some repos (notably Draft) publish tags before their release assets are uploaded — bumping to such a tag breaks every download attempt. Cheap check:

```bash
# Substitute repo + tag + a representative asset filename
curl -sI -o /dev/null -w "%{http_code}\n" -L \
  "https://github.com/Azure/draft/releases/download/<tag>/draft-linux-amd64"
```

If a bump is warranted, edit the `default:` in `package.json` `contributes.configuration.<setting>.default`. No other file needs to change (kubelogin substitution flows automatically via the placeholder).

#### 5b.2. GitHub Actions pinned in workflow templates

Templates under `resources/yaml/*.template.yaml` reference five actions with major-version pins. Major tags auto-receive minor/patch fixes, so bumping is only needed when a new major ships.

```bash
grep -h "uses:" resources/yaml/*.template.yaml | sort -u
for repo in actions/checkout Azure/login Azure/use-kubelogin Azure/aks-set-context Azure/k8s-deploy; do
  echo -n "$repo: "
  gh api "repos/$repo/releases" --jq \
    '[.[] | select(.prerelease==false and .draft==false)] | .[0].tag_name'
done
```

**Before bumping a major**, skim the release notes of the target major on GitHub. Most Azure/* action majors in the last cycle have been pure Node.js runtime bumps (Node 20 → Node 24) — safe. Watch for:

- Renamed/removed action inputs (would silently drop the value from generated YAML)
- Changed default authentication behavior (especially `azure/login`, `Azure/aks-set-context`)
- New required inputs

If bumping, update all four workflow templates (`aks-deploy.template.yaml`, `aks-deploy-managed-ns.template.yaml`, `workflow-multi-deploy-job.template.yaml`, `workflow-multi-deploy-job-managed-ns.template.yaml`, plus `workflow-multi-build-job.template.yaml` for `checkout`/`login`). Then update the corresponding assertions in `src/tests/suite/containerAssist/workflowTemplate.test.ts` — they hard-code version numbers.

#### 5b.3. Kubelogin cross-check

After all bumps, verify that the setting default and any test fixtures agree:

```bash
grep -n "kubelogin" package.json src/commands/aksContainerAssist/workflowTemplate.ts
```

The setting default is the source of truth. `workflowTemplate.ts` reads it via `getKubeloginConfig()` at generation time; no hard-coded fallback is expected in that file. If someone reintroduced a `KUBELOGIN_FALLBACK_VERSION` constant, flag it — it recreates the two-source-of-truth drift that was fixed in the pin-bump PR.

#### 5b.4. When to bump vs defer

- **Always bump** if a version is more than 6 months stale — CVEs accumulate.
- **Bump conservatively** for actions whose majors have shipped in the last 30 days — let the ecosystem shake out.
- **Defer** if the release engineer can't validate the bump end-to-end (generate a workflow via the extension, push, confirm the run succeeds) on a real cluster before merge. Bumping without smoke-testing is worse than staying pinned.

Include the version bumps in the release PR (same commit or a preceding PR). Note them in the What's New doc under a "Dependency updates" line so users know their generated workflows will change.

### 6. Create the New What's New Doc

Path: `docs/book/src/release/whats-new-<x.y.z>.md`

**Source the content from merged PRs since the last release.** Do not invent highlights.

#### 6a. Collect merged PRs since the previous release

Find the previous release tag, then list every PR merged into `main` since that tag was cut:

```bash
# Previous release tag — Azure/vscode-aks-tools tags releases as `x.y.z` (no `v` prefix; verify with `git tag --sort=-v:refname | head -5`)
PREV=$(git tag --sort=-v:refname | head -1)

# Cutoff date = commit date of the previous release tag (ISO 8601)
SINCE=$(git log -1 --format=%cI "$PREV")

# All PRs merged into main since the previous release
gh pr list \
  --repo Azure/vscode-aks-tools \
  --base main \
  --state merged \
  --search "merged:>=$SINCE" \
  --limit 200 \
  --json number,title,author,mergedAt,labels,url \
  > /tmp/release-prs.json
```

Cross-check with `git log --oneline --merges "$PREV"..upstream/main` to catch anything `gh` missed.

#### 6b. Classify and curate

Group the PRs into:
- **Headline features** — new user-visible commands, panels, integrations, feature flags
- **Improvements / fixes** — bug fixes, UX polish, perf, telemetry
- **Dependencies & infra** — dependabot, build, CI, docs-only changes

Drop the dependency/infra bucket from the body unless the user wants it called out. Bot-authored PRs (e.g., `dependabot[bot]`) should be summarised in one line, not listed individually.

For each headline item, capture: PR number, one-sentence summary in user terms (not commit-message voice), and link target — prefer the corresponding feature doc under `docs/book/src/features/` over the PR URL.

Ask the user to confirm the curated list before drafting the doc.

#### 6c. Collect contributor acknowledgements

This repo's `CHANGELOG.md` history ends every release with a thank-you line. Mirror that in the What's New doc:

```bash
jq -r '.[].author.login' /tmp/release-prs.json | sort -u
```

Exclude bots (`*[bot]`). Render as: `Thanks to @user1, @user2, ... for contributions, testing, and reviews.`

#### 6d. Draft the doc

Use the existing latest file as the template (same headings, same screenshot conventions). Mandatory sections:

```markdown
# What's New in <x.y.z>

<one-paragraph framing — what this release is about, derived from the headline PRs>

## Release focus

<bulleted summary of headline items>

## Feature flags at a glance (omit if none introduced or changed)

## <Numbered feature section per highlight>

Highlights:
- ...

Read full details:
- [Feature doc title](../features/<feature>.md)

## Behavior and compatibility

## Recommended reader path

## Screenshots (only if assets exist under docs/book/src/resources/)
```

Rules:
- Link to feature docs via relative paths (`../features/...`).
- Only embed screenshots that actually exist on disk under `docs/book/src/resources/`. Verify before linking.
- Keep the file readable on `mdbook` (no HTML-only constructs).

### 7. Remove the Stale Prior What's New File

```bash
git rm docs/book/src/release/whats-new-<prev>.md
```

The previous What's New is preserved in git history and in the GitHub Release. Only the current release's doc lives in the book.

### 8. Update Book Navigation and Indexes

These three files all reference the What's New doc and must be updated together:

- `docs/book/src/SUMMARY.md` — replace the `What's New in <prev>` line under the `- [Release]` section.
- `docs/book/src/release.md` — replace the `What's New in <prev>` bullet.
- `docs/book/src/README.md` — replace the `What's New in <prev>` bullet under `## Development and Release`.

Pattern for each: change both the display text (`What's New in <prev>` → `What's New in <new>`) and the link target (`whats-new-<prev>.md` → `whats-new-<new>.md`).

After edits, run:

```bash
grep -rn "whats-new-<prev>" docs/   # must return zero matches
grep -rn "What's New in <prev>" docs/   # must return zero matches
```

### 9. Update `releasing.md` Only If Process Changed

`docs/book/src/release/releasing.md` documents the release process itself, not a per-release artifact. Do NOT touch it just to bump a version.

Update it only if the user explicitly says the process changed (e.g., new pipeline, new required step, new secret).

`docs/maintenance/README.md` currently mirrors `releasing.md`. If you update one, mirror the change to the other and tell the user.

### 10. CHANGELOG.md — DO NOT UPDATE

Per the deprecation notice at the top of `CHANGELOG.md` (as of 1.6.14), the changelog is no longer maintained. Release notes live in:
- The new `whats-new-<x.y.z>.md` doc
- The GitHub Release body (auto-generated by the publish pipeline)

If the user explicitly insists on a CHANGELOG entry, add a `## [x.y.z]` section in Keep-a-Changelog format and warn them it's outside current convention.

### 11. Verify the Build Still Works

```bash
npm install --no-audit --no-fund    # only if package-lock looks dirty; usually skip
npm run lint
npm run webpack                     # confirms TS + bundling still succeed
```

The expensive tests are not required for a version-bump PR; skip them unless the user asks.

### 12. Commit

Single commit, conventional message:

```bash
git add package.json package-lock.json \
        docs/book/src/release/whats-new-<x.y.z>.md \
        docs/book/src/SUMMARY.md \
        docs/book/src/release.md \
        docs/book/src/README.md
# plus `git rm` of the prior whats-new file (already staged by step 7)

git commit -m "chore(release): prepare <x.y.z>"
```

**Never commit without confirming with the user first.** (User preference — see `/memories/git-worktrees.md`.)

### 13. Push and Open the PR

```bash
git push -u origin publish-<x.y.z>
gh pr create \
  --repo Azure/vscode-aks-tools \
  --base main \
  --head <user>:publish-<x.y.z> \
  --title "chore(release): <x.y.z>" \
  --body-file <(cat <<'EOF'
## Release PR for vX.Y.Z

- Bumps `package.json` / `package-lock.json` to `<x.y.z>`
- Adds `docs/book/src/release/whats-new-<x.y.z>.md`
- Removes stale `whats-new-<prev>.md`
- Updates `SUMMARY.md`, `release.md`, `README.md` navigation

After merge, trigger the internal 1ES publish pipeline to push to the marketplace.
EOF
)
```

Ask the user before pushing. Do not force-push.

## Final Checklist

Report this to the user before declaring done:

- [ ] `package.json` version is `<x.y.z>`
- [ ] `package-lock.json` root + `packages.""` versions are `<x.y.z>`
- [ ] `docs/book/src/release/whats-new-<x.y.z>.md` exists and links resolve
- [ ] `docs/book/src/release/whats-new-<prev>.md` deleted
- [ ] `SUMMARY.md`, `release.md`, `README.md` reference only `<x.y.z>`
- [ ] No stray references to `<prev>` in `docs/` (`grep` returns empty)
- [ ] `CHANGELOG.md` untouched (intentional — deprecated)
- [ ] Build passes
- [ ] Branch is `publish-<x.y.z>`, off latest `upstream/main`
- [ ] PR opened against `Azure/vscode-aks-tools:main`

## Repo Facts (verified)

- Upstream: `https://github.com/Azure/vscode-aks-tools.git`
- Default branch: `main`
- Project version lives in: root `package.json` + root `package-lock.json` only
- `webview-ui/package.json` is private, stays at `0.0.0`
- `.vscode/tasks.json` `"version": "2.0.0"` is schema, not project version
- Publish workflow: `.github/workflows/1es-pipeline.yml` (internal signed pipeline)
- `CHANGELOG.md` deprecated since 1.6.14
