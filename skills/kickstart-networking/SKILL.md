---
name: kickstart-networking
description: Core Azure networking concepts — VNets, subnets, NSGs, private endpoints, and DNS.
disable-model-invocation: true
---

# Networking Fundamentals

## Virtual Networks (VNets)

A VNet is a private address space in Azure. Choose a CIDR that doesn't overlap with on-premises or peered networks.

Recommended address spaces:
- `10.0.0.0/16` — 65,534 hosts (good for medium workloads)
- `10.0.0.0/8` — 16M hosts (large enterprises)

## Subnets

Divide the VNet into subnets by function:

| Subnet | Purpose | Typical CIDR |
|--------|---------|-------------|
| `snet-app` | Application workloads (AKS nodes) | /22 |
| `snet-data` | Databases, storage private endpoints | /24 |
| `snet-mgmt` | Bastion, admin VMs | /27 |
| `snet-agw` | Application Gateway | /26 |
| `AzureBastionSubnet` | Azure Bastion (required name) | /27 |

## Network Security Groups (NSGs)

- Attach to subnets (not NICs) for simplicity.
- Default-deny inbound from internet.
- Allow only required ports explicitly.
- Use Application Security Groups for workload-level rules.

## Private Endpoints

Use private endpoints for PaaS services (Storage, Key Vault, SQL, ACR):
1. Allocate a private IP in `snet-data`.
2. Create a Private DNS Zone linked to the VNet.
3. Disable public network access on the service.

## DNS

Use Azure-provided DNS (`168.63.129.16`) for VNet-internal resolution. For custom domains, deploy Azure Private DNS Zones.
