---
name: kickstart-cluster-status
description: "Non-blocking cluster status peek — run at the end of Phases 3, 4, 5 to check AKS provisioning progress without hanging."
disable-model-invocation: true
---

# Cluster Status Check

A non-blocking peek at the background cluster provision. Run at the end of Phases 3, 4, and 5. Wrap in `timeout` to prevent hanging.

```bash
timeout 15 az aks show --name <cluster> --resource-group <rg> --subscription <sub> --query "{state:provisioningState, power:powerState.code}" --output json --only-show-errors
```

If timed out (exit 124), skip and retry next phase.

- **`Succeeded`**: Attach ACR if not done yet (use the ACR attachment approach from `/kickstart-handoff`, step 6c). Remember this for Phase 6.
- **`Creating`**: Note it, continue.
- **`Failed`**: Get details from `az monitor activity-log list --resource-group <rg> --status Failed --max-events 3`. Common failures:
  - **"could not find a suitable VM size"**: The region doesn't have capacity or the subscription lacks quota for the D-family SKUs AKS Automatic needs. Suggest trying a different region from the recommended list (westus2, westus3, eastus2, swedencentral). Link to quota page: `https://portal.azure.com/#view/Microsoft_Azure_Capacity/QuotaMenuBlade/~/myQuotas`
  - **QuotaExceeded**: Suggest different region or quota increase.
  - **OperationNotAllowed**: Provider not registered or policy blocking.
  - **InvalidParameter**: Bad name — re-collect from user.
  Offer retry via `vscode/askQuestions`.
- **404**: `az aks create` may have failed silently. Check the RG exists, retry creation.

Also check ACR:
```bash
timeout 15 az acr show --name <acr> --resource-group <rg> --subscription <sub> --query provisioningState --output tsv --only-show-errors
```
