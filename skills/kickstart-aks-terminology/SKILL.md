---
name: kickstart-aks-terminology
description: "Terminology rules for pre-deploy conversations. Use product-facing terms (app, workload, deployment, URL) before deployment; Kubernetes terms (pod, ingress, HPA) only after deployment or when the user explicitly asks."
disable-model-invocation: true
---

# AKS Monitoring

## Azure Monitor managed Prometheus

AKS Automatic enables **Azure Monitor managed service for Prometheus** by default. Metrics are collected without installing Prometheus yourself.

Scrape additional targets with `PrometheusRuleGroup`:

```yaml
apiVersion: azuremonitor.microsoft.com/v1
kind: PrometheusRuleGroup
metadata:
  name: my-app-rules
spec:
  interval: PT1M
  rules:
    - record: job:http_requests:rate5m
      expr: rate(http_requests_total[5m])
```

## Grafana

A managed Grafana workspace is linked to the cluster. Pre-built AKS dashboards are available under **Azure Monitor > Kubernetes**.

## Container Insights

Container Insights captures logs and live metrics from all pods. No agent installation required. Query logs via:

```kusto
ContainerLog
| where LogEntry contains "ERROR"
| project TimeGenerated, ContainerName, LogEntry
```

## Alerting

Recommended alert rules:
- Node CPU utilization > 80% for 5 minutes
- Pod restart count > 5 in 10 minutes
- PVC utilization > 85%
- Control plane API server latency p99 > 500ms
