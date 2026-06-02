---
name: kickstart-pim-activation
description: "PIM (Privileged Identity Management) eligible role activation. Checks for activatable roles via az rest and guides the user through portal-based activation when they hit 403 errors on role assignments."
disable-model-invocation: true
---

# PIM Eligible Role Activation

When the user gets a **403** on `az role assignment create` or `az aks update --attach-acr` (meaning they lack `Microsoft.Authorization/roleAssignments/write`), check whether they have PIM-eligible roles they can self-activate before falling back to admin hand-off.

## Step 1 — List eligible roles

```bash
az rest --method GET \
  --uri "https://management.azure.com/subscriptions/<sub>/providers/Microsoft.Authorization/roleEligibilityScheduleInstances?\$filter=asTarget()&api-version=2020-10-01" \
  --query "value[].{role:properties.roleDefinition.displayName, scope:properties.scope}" \
  -o table
```

## Step 2 — If eligible roles found

Show the user which roles they can activate and link them to the resource's IAM page in the portal. Construct the link using the resource type that failed:

**For AKS cluster resources:**
```
https://portal.azure.com/#@<tenant>/resource/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ContainerService/managedClusters/<cluster>/users
```

**For ACR resources:**
```
https://portal.azure.com/#@<tenant>/resource/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ContainerRegistry/registries/<acr>/users
```

Then give these instructions:

> **You have PIM-eligible roles you can activate.** Open the link below to activate a role that grants the needed permission:
>
> `<portal link>`
>
> 1. Click **"View my access"**
> 2. Select the **"Eligible assignments"** tab
> 3. Find a role that grants the needed permission (e.g. **Owner**, **Contributor**, or **User Access Administrator**) and click **"Activate"**
> 4. Fill in the justification and duration, then confirm
> 5. Come back here and let me know once it's activated

Use `vscode_askQuestions` to ask the user to confirm activation. After they confirm, wait 30 seconds for propagation, then validate by retrying the command that originally failed. If it still fails, suggest waiting another minute and retrying once more.

## Step 3 — If no eligible roles found

Fall back to **admin hand-off**:
- Print the exact `az role assignment create` command the admin needs to run
- Ask the user to confirm once their admin has run it
- Validate by retrying the failed command or polling `az role assignment list`
