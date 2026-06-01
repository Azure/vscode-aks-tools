---
name: kickstart-resource-management
description: Best practices for organizing, tagging, and governing Azure resources at scale.
disable-model-invocation: true
---

# Resource Management

## Naming conventions

Use a consistent naming pattern: `{workload}-{env}-{region}-{type}-{instance}`.

Examples:
- `kickstart-prod-eastus-rg-01` (resource group)
- `kickstart-prod-eastus-aks-01` (AKS cluster)
- `kickstart-prod-eastus-kv-01` (key vault)

Common abbreviations: `rg` (resource group), `aks`, `kv` (key vault), `sa` (storage account), `sql`, `apim`, `afd` (front door).

## Resource groups

- One resource group per application per environment.
- Don't mix environments in the same resource group.
- Use locks (`CanNotDelete` or `ReadOnly`) on production resource groups.

## Tagging strategy

Every resource should have:

| Tag | Example value |
|-----|--------------|
| `environment` | `prod`, `staging`, `dev` |
| `workload` | `kickstart` |
| `owner` | `team-name` |
| `cost-center` | `CC-12345` |
| `created-by` | `terraform` / `bicep` / `portal` |

## Azure Policy

Apply policies at management group or subscription level:
- Require tags on all resources.
- Restrict allowed locations.
- Enforce SKU limits to control costs.
- Audit resources without diagnostic settings.
