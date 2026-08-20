# Simplified AKS Menu Structure

The AKS extension uses a role-based cluster context menu organization as the default experience.

## Setting

```json
{
  "aks.simplifiedMenuStructure": true
}
```

Default value: `true`

After changing this setting, reload the VS Code window. You can also switch modes via the commands **AKS: Switch to Classic Menu** and **AKS: Switch to Grouped Menu** without editing settings directly.

## What changes when enabled

Instead of many top-level commands, cluster actions are grouped into three submenus:

- `Develop & Deploy`
- `Troubleshoot & Diagnose`
- `Manage Cluster`

These stay top-level: `Show In Azure Portal`, `Show Properties`, `AKS Quick Actions`, and `Switch to Classic Menu`.

## Menu grouping overview

`Develop & Deploy`
: Run Kubectl Commands, Attach ACR to Cluster, Create a GitHub Workflow, Run Deployment Safeguards YAML Validation, Install Azure Service Operator, the **Deploy a LLM with KAITO** submenu, Check Argo CD Status (with `aks.argoCDEnabled`), and the Container Assist commands (with `aks.containerAssistEnabledPreview`).

`Troubleshoot & Diagnose`
: The **Run AKS Diagnostics**, **Troubleshoot Network Health**, **Troubleshoot Resource Utilization**, and **Improve security of my cluster** submenus, plus Show Inspektor Gadget and Run Eraser Image Cleanup.

`Manage Cluster`
: Show Properties, Show In Azure Portal, Delete Cluster, Rotate Cluster Certificate, Reconcile Cluster.

## Container Assist in the new menu

With `aks.containerAssistEnabledPreview` enabled (the default), `AKS: Migrate Application to AKS` appears under `Develop & Deploy`. With a workspace folder also open, `AKS: Generate Dockerfiles and K8s Manifests for App` and `AKS: Deploy App with Automated Pipeline` appear alongside it.

## Switching between Classic and Grouped menus

Two commands let you switch menu modes without opening Settings:

| Command | Effect |
|---------|--------|
| **AKS: Switch to Classic Menu** | Sets `aks.simplifiedMenuStructure` to `false` and prompts to reload. |
| **AKS: Switch to Grouped Menu** | Sets `aks.simplifiedMenuStructure` to `true` and prompts to reload. |

Both commands are available in:

- The **Command Palette** (`Cmd+Shift+P` / `Ctrl+Shift+P`).
- The **AKS cluster context menu** (right-click on a cluster in the Azure/Kubernetes Cloud Explorer).  
  Only the applicable command is shown — if the grouped menu is active you see "Switch to Classic Menu", and vice versa.

After running either command, VS Code prompts you to reload the window. The new menu layout takes effect after the reload.

## Backward compatibility

Setting `aks.simplifiedMenuStructure` to `false` restores the classic menu, where every command sits at the top level of the cluster context menu.

## Screenshots

![Classic AKS cluster context menu structure](../resources/new-menu-structure/simplified-menu-1.png)

![Simplified AKS cluster context menu with grouped categories](../resources/new-menu-structure/simplified-menu-2.png)

![Develop and Deploy submenu with Container Assist and related commands](../resources/new-menu-structure/simplified-menu-3.png)

![VS Code user settings showing simplified menu feature flag](../resources/new-menu-structure/simplified-menu-user-setting.png)
