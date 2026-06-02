---
name: kickstart-kaito-gpu
description: "KAITO (Kubernetes AI Toolchain Operator) for GPU workloads and OSS model serving on AKS Automatic. Teaches workspace definitions, supported preset models, and GPU node auto-provisioning."
disable-model-invocation: true
---

# AKS Scaling

## Node auto-provisioning (NAP)

AKS Automatic uses **Node Auto-Provisioning** (Karpenter-based). You do not manage node pools directly.

NAP selects node SKUs automatically based on pending pod resource requests. Influence selection with `NodePool` resources:

```yaml
apiVersion: karpenter.azure.com/v1alpha2
kind: NodePool
metadata:
  name: general
spec:
  template:
    spec:
      requirements:
        - key: karpenter.azure.com/sku-family
          operator: In
          values: ["D"]
```

## Horizontal Pod Autoscaler (HPA)

Standard HPA works out of the box. Set meaningful `resources.requests` so the metrics server can compute utilization:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## KEDA

KEDA is pre-installed in AKS Automatic. Use `ScaledObject` for event-driven workloads:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
spec:
  scaleTargetRef:
    name: my-worker
  triggers:
    - type: azure-servicebus
      metadata:
        queueName: my-queue
        namespace: my-servicebus
```

## Vertical Pod Autoscaler (VPA)

VPA is available for recommendation mode. Do not use `updateMode: Auto` in production without testing.
