---
name: kickstart-github-actions-oidc
description: Setting up OIDC federation between GitHub Actions and Azure for keyless authentication.
disable-model-invocation: true
---

# GitHub Actions OIDC Federation with Azure

OIDC (OpenID Connect) federation lets GitHub Actions workflows authenticate to Azure without storing long-lived secrets. The GitHub Actions runner obtains a short-lived OIDC token and exchanges it for an Azure access token.

## How it works

1. GitHub Actions issues an OIDC token for the workflow run.
2. The `azure/login` action presents that token to Azure AD.
3. Azure AD validates the token against a registered federated credential on a managed identity or service principal.
4. If valid, Azure issues an access token scoped to the configured roles.

## Required Azure setup

```bash
# Create a user-assigned managed identity
az identity create --name <name> --resource-group <rg>

# Add a federated credential for the repo + branch
az identity federated-credential create \
  --identity-name <name> \
  --resource-group <rg> \
  --name github-<repo>-main \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:<owner>/<repo>:ref:refs/heads/main \
  --audiences api://AzureADTokenExchange
```

## Required GitHub secrets

Set these three secrets in the repository (use `github:set_secret`):

| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | Managed identity client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Target subscription ID |

## Workflow snippet

```yaml
- uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

No `creds` JSON secret required. No service principal password to rotate.

## Subject claim patterns

| Trigger | Subject |
|---|---|
| Push to `main` | `repo:<owner>/<repo>:ref:refs/heads/main` |
| Pull request | `repo:<owner>/<repo>:pull_request` |
| Environment | `repo:<owner>/<repo>:environment:<env>` |

Use environment subjects for production deployments to enforce manual approval gates.
