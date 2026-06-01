---
name: kickstart-cost-estimation
description: How to estimate Azure resource costs using the Retail Prices API and total-cost-of-ownership patterns.
disable-model-invocation: true
---

# Cost Estimation

Always estimate costs before recommending a resource topology.

## Workflow

1. Use `azure.pricing_lookup` to get unit prices for each SKU and meter.
2. Use `azure.estimate_cost` to compute monthly totals given expected usage.
3. Show results with the `azure/CostEstimate` component.

## Key cost drivers by service

| Service | Primary cost driver |
|---------|-------------------|
| Virtual Machines | vCPU + RAM hours, OS license, disk |
| AKS | Node pool VM hours + load balancer + egress |
| Azure SQL | DTU/vCore hours + storage + backup |
| Storage Accounts | Capacity (GB) + operations + egress |
| App Service | Plan tier × hours |
| Azure OpenAI | Token consumption per model |

## Cost optimization tips

- Use Reserved Instances (1- or 3-year) for stable workloads — up to 72% savings.
- Spot VMs for interruptible batch workloads.
- Auto-scale to reduce idle capacity.
- Right-size: measure actual CPU/memory before over-provisioning.
- Use Azure Cost Management + budgets and alerts.

## Caveats

Retail prices are list prices. EA, MCA, and CSP customers may have negotiated discounts. Always note this when presenting estimates.
