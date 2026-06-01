---
name: kickstart-acr-integration
description: "ACR integration for AKS Automatic. Teaches attaching an ACR, image reference conventions (digest pinning, no :latest), and pull-secret-free authentication via the managed identity."
disable-model-invocation: true
---

# AKS Storage

## Storage classes

AKS Automatic provides several built-in storage classes:

| Class | Backend | Use case |
|---|---|---|
| `managed-csi` | Azure Disk (LRS) | General single-node RWO |
| `managed-csi-premium` | Azure Disk (Premium SSD) | IOPS-sensitive workloads |
| `azurefile-csi` | Azure Files (SMB) | Shared RWX across nodes |
| `azurefile-csi-premium` | Azure Files (Premium) | High-throughput shared storage |

## Persistent Volume Claims

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: managed-csi-premium
  resources:
    requests:
      storage: 32Gi
```

## hostPath volumes

**`hostPath` volumes are prohibited** by AKS safeguards and the Restricted pod security standard. Use PVCs instead.

## Backup

Use **Azure Backup for AKS** to protect persistent volumes. Enable in the cluster settings with a backup vault linked to the same resource group.

## StatefulSet storage

For StatefulSets, use `volumeClaimTemplates` — Kubernetes creates one PVC per replica automatically:

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: managed-csi-premium
      resources:
        requests:
          storage: 10Gi
```
