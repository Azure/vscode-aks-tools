# What's New in 2.4.0

Everything added since `2.1.0`, across the `2.2.0`, `2.3.0` and `2.4.0` releases.
Full release history is on the
[GitHub Releases](https://github.com/Azure/vscode-aks-tools/releases) page.

## GitOps with Argo CD, no setup required

Argo CD is now available out of the box — you no longer need to turn on a setting
first. Right-click a cluster and use **AKS: Create Argo CD Application** to scaffold an
application, then **AKS: Apply Argo CD Application to Cluster** to deploy it and
**AKS: Check Argo CD Status** to see how the sync is going. Argo CD itself still needs
to be installed on your cluster; if it isn't, the extension tells you and points you at
the install steps.

See [Argo CD GitOps Integration](../features/argocd-gitops-integration.md).

## Deploy an app with the Kickstart agent (preview)

Kickstart is a Copilot chat agent that takes an application you already have and walks
you all the way to it running on AKS Automatic — working out how to containerise it,
creating the Azure resources, generating the manifests and pipeline, and deploying.
Before it creates anything it shows you an estimated cost, and it favours regions that
currently have capacity so you are less likely to hit a provisioning failure.

Kickstart is off by default. To try it, add this to your settings and reload:

```json
{
  "aks.kickstartEnabledPreview": true
}
```

You will then have **AKS: Launch Kickstart Agent** and
**AKS: Configure Kickstart Cluster** in the Command Palette.

## Container Assist is easier to fit to your project

- **Azure Container Registry is now optional**, and you can pick which files you want
  generated instead of taking the whole set.
- **Generated manifests no longer pick up build output.** Directories like `dist/`,
  `target/` and `bin/` are skipped, so you get manifests for your application rather
  than for compiled artifacts.
- **Deployment Safeguards validation now shows you what it found** instead of stopping
  with an error, so you can see every policy issue at once and decide what to fix.
- **Your own namespace annotations and labels are preserved** when the extension
  updates a managed namespace.

See [Container Assist Integration (Preview)](../features/container-assist-integration.md).

## Cluster commands are grouped by task

Right-clicking a cluster now shows three groups — **Develop & Deploy**,
**Troubleshoot & Diagnose** and **Manage Cluster** — instead of one long list, so
there is less to scan when you know what kind of task you are doing.

If you prefer the old layout, run **AKS: Switch to Classic Menu** at any time.

See [Simplified AKS Menu Structure](../features/simplified-menu-structure.md).

## Where to go next

- [What the extension can do](../features/features.md)
- [Every command, setting and pinned tool version](../reference.md)
