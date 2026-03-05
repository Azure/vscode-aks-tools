# Simplified AKS Menu Structure (Feature Flag)

This release introduces a new role-based AKS cluster context menu organization behind a feature flag.

## Feature flag

```json
{
  "aks.simplifiedMenuStructure": true
}
```

Default value: `false`

After changing this setting, reload the VS Code window.

## What changes when enabled

Instead of many top-level commands, cluster actions are grouped into three submenus:

- `Develop & Deploy`
- `Troubleshoot & Diagnose`
- `Manage Cluster`

Direct commands `Show In Azure Portal` and `Show Properties` remain available.

## Menu grouping overview

`Develop & Deploy`
: Run Kubectl commands, Container Assist (preview), Attach ACR, Create GitHub Workflow, KAITO submenu, Install Azure Service Operator.

`Troubleshoot & Diagnose`
: AKS Diagnostics submenu, Inspektor Gadget, network troubleshooting submenu, resource utilization submenu, Eraser Tool, security submenu.

`Manage Cluster`
: Show properties, show in portal, delete cluster, rotate certificate, reconcile cluster.

## Container Assist in the new menu

When both feature flags are enabled:

- `aks.simplifiedMenuStructure = true`
- `aks.containerAssistEnabledPreview = true`

and a workspace folder is open, `AKS: Run Container Assist (Preview)` appears under `Develop & Deploy`.

## Backward compatibility

When `aks.simplifiedMenuStructure` is `false`, the previous menu organization stays active.
This allows gradual rollout, internal validation, and user feedback collection without breaking existing workflows.

## Suggested rollout plan

1. Keep default `false` for broad compatibility.
2. Enable in dogfood or preview cohorts.
3. Collect feedback on discoverability and click depth.
4. Promote to default once validated.

## Screenshot placeholders

Add screenshots under `docs/book/src/resources/` and then replace the placeholder notes below.

Placeholder 1:
- Suggested file: `aks-menu-old-structure.png`
- Context: AKS cluster context menu with classic structure (`aks.simplifiedMenuStructure = false`)

Placeholder 2:
- Suggested file: `aks-menu-simplified-structure.png`
- Context: AKS cluster context menu with grouped structure (`aks.simplifiedMenuStructure = true`)

Placeholder 3:
- Suggested file: `aks-menu-develop-deploy-container-assist.png`
- Context: `Develop & Deploy` submenu expanded with Container Assist visible
