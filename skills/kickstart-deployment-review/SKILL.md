---
name: kickstart-deployment-review
description: How to review and validate Azure deployments before executing them using what-if and pre-flight checks.
disable-model-invocation: true
---

# Deployment Review

Always perform a what-if analysis before executing any ARM deployment.

## Pre-deployment checklist

1. **Subscription and resource group confirmed** — show `azure/SubscriptionSelector` if no subscription is active.
2. **What-if executed** — call `azure.what_if` and present results using `azure/DeploymentStatus`.
3. **No unexpected deletes** — if what-if shows resource deletions the user didn't intend, pause and explain.
4. **User confirmed** — present `azure/AzureAction` confirm gate; deployment only proceeds on explicit confirm.

## Interpreting what-if results

| Change type | Meaning | Action |
|-------------|---------|--------|
| `Create` | New resource will be created | Verify params look right |
| `Modify` | Existing resource will be updated | Show diff of changed properties |
| `Delete` | Resource will be removed | Warn user explicitly |
| `Deploy` | No changes (idempotent) | Safe to proceed |
| `Ignore` | Resource exists outside this template | No action needed |
| `Unsupported` | ARM cannot determine change | Treat as risky |

## After deployment

1. Show deployment status via `azure/DeploymentStatus`.
2. Confirm resource exists with `azure.arm_get`.
3. Offer to return to `azure.architect` for post-deployment review.
