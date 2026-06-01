---
name: kickstart-security-hardening
description: Azure security baseline — RBAC, Key Vault, managed identity, network isolation, and Microsoft Defender.
disable-model-invocation: true
---

# Security Hardening

## Principle of least privilege

- Assign RBAC at the narrowest scope (resource > resource group > subscription > management group).
- Use built-in roles before creating custom ones.
- Common roles: `Reader`, `Contributor`, `Owner`, `Key Vault Secrets User`, `Storage Blob Data Reader`.
- Avoid `Owner` on production subscriptions — use `Contributor` + specific data-plane roles.

## Key Vault best practices

- Soft delete + purge protection: **always on** in production.
- Restrict access with Key Vault Firewall + private endpoint.
- Use Managed Identity (not service principal secrets) to read secrets.
- Rotate secrets every 90 days; use Key Vault references in App Service / AKS.
- Audit access with diagnostic settings → Log Analytics.

## Encryption

- Storage at rest: enabled by default (AES-256, Microsoft-managed keys).
- Customer-managed keys (CMK) in Key Vault for compliance requirements.
- TLS 1.2+ everywhere; disable older protocols.
- Encryption in transit: HTTPS-only for storage, SQL, App Service.

## Network isolation

- Disable public network access on PaaS services when possible.
- Use private endpoints for Storage, Key Vault, SQL, ACR.
- Apply NSGs with default-deny inbound.

## Microsoft Defender for Cloud

Enable Defender plans for:
- Servers (VM vulnerability scanning)
- Containers (AKS runtime threat detection)
- Storage (malware scanning, anomaly detection)
- Key Vault (unusual access patterns)
- SQL (SQL injection detection)

Secure Score is your KPI — target 80%+.
