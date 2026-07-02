---
name: kickstart-github-pr-conventions
description: Pull request conventions for trunk-based development and AKS deployment repos.
disable-model-invocation: true
---

# GitHub PR Conventions

## Trunk-based development

Keep branches short-lived. Merge to the default branch (usually `main`) at least daily. Avoid long-running feature branches.

### Branch naming

| Prefix | Use |
|---|---|
| `feat/<slug>` | New features |
| `fix/<slug>` | Bug fixes |
| `chore/<slug>` | Tooling, deps, config |
| `deploy/<slug>` | Deployment-only changes |

### Commit messages

Use Conventional Commits format:
```
feat(scope): short description

Optional longer body. Explain why, not what.

Closes #<issue>
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`.

## PR titles

Match the first commit message. Keep under 72 characters. Start with a type prefix.

## PR description template

```markdown
## What
Short summary of the change.

## Why
Context for the reviewer.

## How
Key implementation decisions.

## Testing
How you verified this works.

Closes #<issue>
```

## Review protocol

- At least one approval required before merge.
- Address all blocking comments before requesting re-review.
- Prefer squash merge for feature branches; merge commit for releases.

## Preview environments

For repos with preview environment support, each PR can trigger a deployment to a short-lived AKS namespace. Comment `/deploy-preview` on the PR to trigger. The deployment URL is posted back as a PR comment.

## Branch protection rules

Recommended settings for the default branch:
- Require PR reviews (min 1)
- Require status checks to pass (CI workflow)
- Require branches to be up to date
- Restrict who can push directly
