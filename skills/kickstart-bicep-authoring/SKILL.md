---
name: kickstart-bicep-authoring
description: Writing idiomatic, safe, and reviewable Bicep templates for Azure resources.
disable-model-invocation: true
---

# Bicep Authoring

Bicep is the preferred IaC language for Azure deployments in Kickstart.

## File structure

```bicep
// Parameters first
param location string = resourceGroup().location
param name string

// Variables derived from params
var uniqueSuffix = uniqueString(resourceGroup().id)

// Resources
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: '${name}${uniqueSuffix}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
}

// Outputs last
output accountName string = storageAccount.name
output primaryEndpoint string = storageAccount.properties.primaryEndpoints.blob
```

## Authoring rules

1. **Always pin API versions** — use `@2023-01-01` not `@latest`.
2. **Use `uniqueString()` for globally unique names** — storage accounts, key vaults, ACR.
3. **Parameterize everything env-specific** — location, SKU, capacity.
4. **Use `existing` resources** — reference resources not managed by this template with `existing`.
5. **Output IDs and endpoints** — downstream consumers need them.

## Validation

Always call `azure.validate_bicep` before presenting a template to the user. Fix all errors; warnings are acceptable if explained.

## Security defaults

- Storage: disable public blob access, enable HTTPS-only, set minimum TLS to 1.2.
- Key Vault: soft-delete + purge protection enabled.
- SQL: `minimalTlsVersion: '1.2'`.
- Network: no `0.0.0.0/0` inbound rules without explicit user approval.
