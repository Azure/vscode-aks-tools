---
name: kickstart-handoff
description: "Pre-deploy check playbook — verify cluster readiness and ACR attachment before deployment."
disable-model-invocation: true
---

# Pre-Deploy Check

Verify that Azure infrastructure from the Configure phase is ready before deploying. This is the only phase that may block waiting on Azure.

## Cluster Readiness

Check the cluster provisioning state first:
```bash
az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "provisioningState" --output tsv
```

### Already Succeeded
Skip straight to ACR attachment.

### Still Creating
Use `az aks wait` instead of manual polling:
```bash
az aks wait --name <cluster> --resource-group <rg> --subscription <sub> --created --interval 30 --timeout 600
```
Tell the user: "Cluster is still provisioning. Waiting for it to finish — this usually takes a few more minutes."

If it times out (10 min), check the state again and report the error.

### Failed
Show the error and use `vscode_askQuestions`:
  ```json
  {
    "questions": [{
      "header": "Cluster failed",
      "question": "Cluster provisioning failed. What do you want to do?",
      "options": [
        { "label": "Retry creation", "recommended": true },
        { "label": "Use a different cluster" },
        { "label": "Cancel" }
      ]
    }]
  }
  ```

## ACR Attachment

Ensure the ACR is attached to the cluster:
```bash
az aks update --name <cluster> --resource-group <rg> --attach-acr <acr> --subscription <sub>
```

## Pre-Flight Summary

Present a final summary of what will be deployed and use `vscode_askQuestions`:
```json
{
  "questions": [{
    "header": "Ready to deploy",
    "question": "Everything looks good. Deploy now?",
    "options": [
      { "label": "Yes, deploy", "recommended": true },
      { "label": "Review artifacts first" },
      { "label": "Not yet" }
    ]
  }]
}
```

## Exit Criteria
- Cluster provisioning state is `Succeeded`.
- ACR is attached to the cluster.
- User confirms readiness.
- Announce: "Pre-deploy check complete — moving to Deploy."
