---
name: kickstart-configure-infra
description: "Configure Infrastructure phase playbook — launch the dedicated Kickstart cluster-setup view, which collects and creates the Azure resources (subscription, resource group, AKS Automatic cluster, ACR) and hands the results back to the chat."
disable-model-invocation: true
---

# Configure Infrastructure

Azure resource selection and creation happen in a dedicated webview — the **Kickstart Cluster** view — not through `az` commands you run. Your job in this phase is to launch that view with good app context, then wait for it to report back.

## Step 1 — Launch the cluster-setup view

Use `vscode_runCommand` to run command id `aks.kickstartCluster`, passing the app context as a single JSON argument so the view can pre-fill sensible, app-derived resource names:

```json
{
  "appName": "<short kebab-case app slug, e.g. orders-api>",
  "appSummary": "<one-line description, e.g. Node.js REST API on port 3000>",
  "suggestedLocation": "<region if you already know a preference, otherwise omit>"
}
```

- Derive `appName` from what you learned in Discovery — lowercase, hyphenated, no spaces. The view turns it into suggested resource-group, cluster, and registry names.
- Omit any field you don't know; all are optional.

### Region selection (capacity-aware)

AKS Automatic provisions node pools on **AKS-owned (HOBO) subscriptions**, so a region that passes *your* subscription quota check can still fail to provision when the AKS-side capacity is constrained — and both failures look identical (the deploy just hangs or fails with no clear cause). Maximize the chance of a clean provision by steering toward **lower-contention regions** and treating the highest-demand regions as a last resort:

- **Prefer (low capacity risk):** `eastus2`, `westus3`, `southcentralus`, `canadacentral`, `swedencentral`, `japaneast`.
- **Acceptable (moderate):** `centralus`, `westus2`.
- **Avoid unless the user requires it (high capacity risk):** `eastus`, `westeurope`, `southeastasia`.

Only set `suggestedLocation` when the user states a region preference or a compliance / data-residency need — then pick the lowest-risk region that satisfies it (e.g. `eastus2` instead of `eastus` for US, `swedencentral` instead of `westeurope` for EU). If you have no preference to honor, **omit `suggestedLocation`**: the view runs a live quota scan across the low-risk regions and auto-recommends the best available one.

## Step 2 — Hand off to the view

After launching, post a short message telling the user to complete cluster setup in the view that just opened, and that you'll continue automatically once it finishes. Then **end your turn** — do not ask questions or run commands while the user is working in that view.

## What the view does (so you don't)

The cluster view owns the entire Azure flow end to end:
- Subscription selection (from the signed-in account) and a region picker.
- Create-new or use-existing resource group.
- Provider registration and quota pre-flight checks.
- Creates the AKS Automatic cluster and the ACR, then **attaches the registry to the cluster** (grants the cluster's kubelet identity `AcrPull`).

Do NOT run `az account set`, `az group create`, `az acr create`, `az aks create`, or any ACR-attach command yourself — the view performs all of these.

## Step 3 — Resume on handback

When provisioning completes, the view reopens this chat with a message containing the provisioned **subscription, resource group, cluster, ACR, and registry login server**. Confirm those names in your opening prose (e.g. "✓ Cluster **aks-orders-api-dev** and registry **acrordersapi1a2b** are ready"), then continue to Phase 3 (Design). Use these exact names in every later phase (manifests, Bicep, build & push).

If cluster setup fails, the view surfaces the error in its own progress panel. If the user returns to the chat and reports a problem, help them resolve it — for role-assignment 403s, follow `/kickstart-pim-activation` — then offer to relaunch `aks.kickstartCluster`.
