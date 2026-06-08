---
name: kickstart-terminal-conventions
description: "How Kickstart agents must shape terminal commands so VS Code's autoApprove allowlist can match them."
disable-model-invocation: true
---

# Terminal Conventions

VS Code matches `chat.tools.terminal.autoApprove` against the **entire command string** passed to `run_in_terminal`. Multi-line scripts, env vars, and shell metacharacters fail the match, so the user is forced to click approve on every read-only probe.

Follow these rules so vetted read-only commands run unattended.

## Rules

1. **One command per `run_in_terminal` call.** Never combine probes with `;`, `&&`, `||`, newlines, or `for`/`while` loops. Five auto-approved calls beat one prompted blob.
2. **Inline literal values.** Never assign shell variables (`SUB=…` then `--subscription $SUB`). The deny rule on `$` will block it. Pass the value directly: `--subscription 10d023e1-58c4-4eb7-b386-4ded55597abb`.
3. **No `echo "=== … ==="` banners.** Pure noise; the agent already narrates what it's running.
4. **No output redirection.** Drop `2>/dev/null`, `> file`, `| tee`. Let the tool capture stdout/stderr and surface errors. (The single allowed exception is the `jq … > tmp && mv tmp file` idiom for atomic state writes — keep that as one call.)
5. **No pipelines, ever — not for filtering, not for output limiting.** `az …` and `kubectl …` have first-class filtering (`--query` / `-o jsonpath` / `-o tsv`). Use that instead of `| jq`, `| grep`, `| awk`. **Do not append `| head`, `| tail`, `| wc`, `| less`, `| cat` either** — the `|` character is on the deny list, so a "harmless" `| head -200` flips the entire call from auto-approve to user-prompt. If output is large, capture all of it and truncate in your own response when you read the result.
6. **No JMESPath arithmetic in backticks.** `--query "[?…].{avail: \`limit - currentValue\`}"` triggers the backtick deny rule. Select the raw fields with `--query "[?…].{limit:limit, used:currentValue}"` and compute the delta in the agent's response.
7. **`-o tsv` for single scalars, `-o json` for objects/arrays.** Both stay on one line and pass the allowlist tail.

## Anti-Pattern → Pattern

### Quota probe (this one was reported)

❌
```bash
SUB=10d023e1-58c4-4eb7-b386-4ded55597abb
echo "=== ContainerService provider ==="
az provider show --namespace Microsoft.ContainerService --subscription $SUB --query registrationState -o tsv
echo "=== swedencentral DSv3 quota ==="
az vm list-usage --location swedencentral --subscription $SUB --output json --query "[?contains(name.value,'standardDSv3Family')].{available: \`limit - currentValue\`, limit:limit, used:currentValue}" 2>/dev/null
```

✅ Four separate `run_in_terminal` calls, no banners, no env var, no backtick arithmetic, no redirect:
```bash
az provider show --namespace Microsoft.ContainerService --subscription 10d023e1-58c4-4eb7-b386-4ded55597abb --query registrationState -o tsv
```
```bash
az provider show --namespace Microsoft.ContainerRegistry --subscription 10d023e1-58c4-4eb7-b386-4ded55597abb --query registrationState -o tsv
```
```bash
az vm list-usage --location swedencentral --subscription 10d023e1-58c4-4eb7-b386-4ded55597abb --query "[?contains(name.value,'standardDSv3Family')].{limit:limit, used:currentValue}" -o json
```
```bash
az acr check-name --name acrcontosoairdev -o json
```

### Multi-region quota scan

❌
```bash
for region in eastus2 westus3 westeurope southeastasia; do az vm list-usage --location $region --subscription <sub> --output json --query "..."; done
```

✅ Four calls (or however many candidate regions you're scoring) — each one matches `^az vm list-usage`.

### "Just truncating long output"

❌
```bash
az account list --query "[?state=='Enabled' && tenantId=='72f988bf-86f1-41af-91ab-2d7cd011db47'].{name:name, id:id, isDefault:isDefault}" -o json | head -200
```
The `|` flips the call to user-prompt even though the `az account list` head is fine.

✅
```bash
az account list --query "[?state=='Enabled' && tenantId=='72f988bf-86f1-41af-91ab-2d7cd011db47'].{name:name, id:id, isDefault:isDefault}" -o json
```
Read the full result, summarize the first N entries in your own response. `az` output is already compact enough — there are no subscriptions large enough to need shell-side truncation.

## Verbs that are auto-approved today

(From `chat.tools.terminal.autoApprove` in `package.json`; check there for the source of truth.)

- `az` reads: `(account|group|aks|acr|provider|resource|role|extension|network|monitor|identity|keyvault|deployment|feature) (show|list|graph)`
- `az aks (get-versions|get-upgrades|check-acr|nodepool (show|list))`
- `az acr (check-name|repository (show|list|list-tags|show-tags|show-manifests))`
- `az vm list-usage`, `az role assignment list`
- `az account (show|list|list-locations|get-access-token|set)`
- `az bicep (version|lint)`
- `kubectl (get|describe|logs|version|cluster-info|api-resources|top)`, `kubectl auth can-i`, `kubectl config (get-contexts|current-context|view)`, `kubectl apply --dry-run=client`
- `helm` reads, `docker` reads, `git` reads, `which`, `command -v`, basic POSIX read utilities

Anything outside this list — including `az aks create`, `az acr build`, `az aks get-credentials`, `kubectl apply`, `kubectl delete`, anything with a deny-listed token — will prompt. That's intentional.
