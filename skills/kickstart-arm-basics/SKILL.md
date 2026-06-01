---
name: kickstart-arm-basics
description: Fundamentals of the Azure Resource Manager API — resource IDs, REST paths, and response shapes.
disable-model-invocation: true
---

# ARM Basics

The Azure Resource Manager (ARM) REST API is the single control plane for all Azure resources.

## Resource ID format

Every Azure resource has a canonical resource ID:

```
/subscriptions/{subscriptionId}/resourceGroups/{rg}/providers/{namespace}/{type}/{name}
```

Examples:
- `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm`
- `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-rg/providers/Microsoft.Network/virtualNetworks/my-vnet`

## API versions

Every ARM call requires an `api-version` query parameter. Use the latest stable version for the resource type. Find it in the Azure REST API docs or the resource provider's `Microsoft.Resources/providers` registration.

## Common response patterns

- **200 OK** — resource exists, body is the resource object.
- **404 Not Found** — resource does not exist.
- **409 Conflict** — concurrent modification; retry with exponential back-off.
- **LRO (Long-Running Operation)** — ARM returns `202 Accepted` with `Azure-AsyncOperation` or `Location` header. Poll until status is `Succeeded` or `Failed`.

## Tool usage

Use `azure.arm_get` to read any ARM resource by path. Always provide a full subscription-scoped path.
