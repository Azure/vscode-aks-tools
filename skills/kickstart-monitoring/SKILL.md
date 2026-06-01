---
name: kickstart-monitoring
description: Setting up observability for Azure resources with Azure Monitor, Log Analytics, and Application Insights.
disable-model-invocation: true
---

# Monitoring Basics

## The Azure Monitoring stack

```
Azure Monitor
├── Metrics           — numeric time-series, 93 days retention
├── Logs (LA)         — structured log data in Log Analytics Workspace
│   ├── Diagnostic Settings → resource logs + activity log
│   └── KQL queries, workbooks, dashboards
└── Application Insights — APM for apps (requests, dependencies, exceptions)
```

## Diagnostic settings

Every production resource should have a diagnostic setting that sends:
- All logs → Log Analytics Workspace
- All metrics → Log Analytics Workspace (and/or Storage for archival)

In Bicep:
```bicep
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-${name}'
  scope: myResource
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
```

## Alerts

Set up metric alerts for:
- CPU > 80% for 5 minutes
- Memory > 85%
- Storage > 90% capacity
- HTTP 5xx error rate > 1%
- Deployment failures

Use Action Groups to route alerts to email, Teams, PagerDuty, or Logic Apps.

## KQL quick reference

```kql
// Failed requests in last hour
requests
| where timestamp > ago(1h) and success == false
| summarize count() by resultCode, bin(timestamp, 5m)
```
