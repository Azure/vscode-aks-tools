---
name: kickstart-pim-activation
description: "PIM (Privileged Identity Management) eligible role activation. Checks for activatable roles via az rest and guides the user through portal-based activation when they hit 403 errors on role assignments."
disable-model-invocation: true
---

# PIM Eligible Role Activation

When the user gets a **403** on `az role assignment create` or `az aks update --attach-acr` (meaning they lack `Microsoft.Authorization/roleAssignments/write`), check whether they have PIM-eligible roles they can self-activate before falling back to admin hand-off.

## Step 1 — Run the built-in permissions check (preferred)

Invoke the bundled VS Code command via `vscode/runCommand`. It performs the active-permissions check **and** the PIM eligibility lookup in one call, and returns a self-contained markdown report you can render directly in the chat.

**Command ID:** `aks.checkRoleAssignmentPermissions`

**Args:**
```json
{
  "subscriptionId": "<sub>",
  "resourceGroup": "<rg>"
}
```

**Returns:**
```ts
{
  cancelled: boolean,
  canCreate?: boolean,             // true if the user can already create role assignments
  scope?: { subscriptionId, subscriptionName, resourceGroup, resourceGroupScopeId },
  verdict?: { canCreate, grantingActions, strippedByNotActions },
  eligiblePimRoles?: Array<{ roleName, scopeId, scopeDisplayName?, grantingAction? }>,
  markdown: string                 // full report — render this verbatim in chat
}
```

**How to use the result:**

- If `canCreate === true`: skip PIM activation entirely; retry the original `az role assignment create` / `az aks update --attach-acr`.
- If `canCreate === false` and `eligiblePimRoles.length > 0`: render `markdown` in the chat, then proceed to **Step 2** for activation guidance.
- If `canCreate === false` and `eligiblePimRoles.length === 0` (or `eligiblePimRoles` is missing): render `markdown` and proceed to **Step 3** (admin hand-off).
- If `error` is set: render the error and fall back to the manual `az rest` query below.

**Manual fallback** (only if the command is unavailable):

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
