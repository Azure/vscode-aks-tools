---
name: kickstart-azure-identity
description: Azure authentication patterns — MSAL, managed identity, service principals, and token acquisition.
disable-model-invocation: true
---

# Azure Identity

Kickstart uses MSAL (Microsoft Authentication Library) for browser-based Azure authentication.

## Authentication flow

1. User initiates sign-in via the `azure:select_subscription` user action.
2. MSAL popup requests the `https://management.azure.com/.default` scope.
3. On success, the access token is stored in the session token store.
4. All Azure tools read the token from `context.tokens['azure']`.

## Token scopes

| Scope | Use |
|-------|-----|
| `https://management.azure.com/.default` | ARM REST API |
| `https://management.core.windows.net/.default` | Classic ARM (legacy) |
| `https://cognitiveservices.azure.com/.default` | Azure AI services |

## Managed Identity (server-side)

For server-side deployments, prefer managed identity over service principals:
- System-assigned: tied to resource lifecycle.
- User-assigned: shareable across resources.
- Eliminates credential rotation.

## Common mistakes

- **Token expiry**: ARM tokens expire in 1 hour. Refresh before long operations.
- **Wrong audience**: `management.azure.com` and `management.core.windows.net` are different — use the correct one.
- **Missing scopes**: Cognitive Services requires its own scope, not ARM.
