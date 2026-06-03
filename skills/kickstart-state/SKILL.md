---
name: kickstart-state
description: "Shared state contract for Kickstart sub-agents. Defines .kickstart/state.json schema and read/write commands so handoffs survive agent boundaries and session restarts."
disable-model-invocation: true
---

# Kickstart State Contract

All Kickstart sub-agents persist their decisions to a single workspace file: `.kickstart/state.json`. This is the **only** reliable channel across agent handoffs and session restarts. Chat scrollback is not a substitute.

## Rules

1. **On entry**, every sub-agent reads `.kickstart/state.json` first. If missing, treat as a fresh run.
2. **After any meaningful decision or action**, merge the new fields into the file and write it back.
3. **On handoff**, set `phase` to the next phase and `lastAgent` to the sub-agent that just finished.
4. Never delete keys other sub-agents set. Only update what you own.
5. If `jq` is unavailable, fall back to writing the whole file with `editFiles` — but prefer the shell approach.

## Schema

```json
{
  "version": 1,
  "phase": "discover | configure | design | generate | review | pre-deploy | deploy | done",
  "lastAgent": "kickstart | kickstart-builder | kickstart-reviewer | kickstart-deployer",
  "updatedAt": "<ISO-8601 UTC>",
  "app": {
    "name": "",
    "language": "",
    "framework": "",
    "port": null,
    "deps": [],
    "envVars": [],
    "existingDockerfile": false,
    "existingCi": false,
    "projectRoot": "."
  },
  "azure": {
    "subscriptionId": "",
    "tenantId": "",
    "resourceGroup": "",
    "cluster": "",
    "acr": "",
    "region": "",
    "namespace": ""
  },
  "cluster": {
    "provisioningState": "Unknown",
    "acrAttached": false,
    "kubeloginInstalled": null,
    "controlPlaneOk": null,
    "dataPlaneOk": null,
    "acrPushOk": null,
    "lastCheckedAt": null
  },
  "artifacts": {
    "dockerfile": null,
    "dockerignore": null,
    "k8s": [],
    "bicep": [],
    "workflow": null
  },
  "review": {
    "status": "pending",
    "failures": [],
    "warnings": []
  },
  "deploy": {
    "imageTag": null,
    "lastStep": null,
    "status": "pending",
    "error": null
  }
}
```

## Ownership

Which agent writes which fields:

| Section | Owner |
|---|---|
| `app` | `kickstart` (Discover) |
| `azure` | `kickstart` (Configure) |
| `cluster` | `kickstart`, `kickstart-deployer` (peeks + final probes) |
| `artifacts` | `kickstart-builder` (Generate) |
| `review` | `kickstart-reviewer` |
| `deploy` | `kickstart-deployer` |
| `phase`, `lastAgent`, `updatedAt` | every agent on entry/exit |

## Read

```bash
mkdir -p .kickstart
[ -f .kickstart/state.json ] || echo '{"version":1,"phase":"discover"}' > .kickstart/state.json
cat .kickstart/state.json
```

## Write (merge with jq)

```bash
mkdir -p .kickstart
tmp=$(mktemp)
jq '. * {
  phase: "<new-phase>",
  lastAgent: "<this-agent-name>",
  updatedAt: "'"$(date -u +%FT%TZ)"'"
}' .kickstart/state.json > "$tmp" && mv "$tmp" .kickstart/state.json
```

For nested updates, pass an object that mirrors the schema:

```bash
jq '. * {
  app: { name: "myapp", language: "python", port: 8000 },
  phase: "configure",
  lastAgent: "kickstart",
  updatedAt: "'"$(date -u +%FT%TZ)"'"
}' .kickstart/state.json > "$tmp" && mv "$tmp" .kickstart/state.json
```

## Status Pill

When summarizing state for the user, render a one-line pill:

`[Phase: <phase> · Cluster: <provisioningState> · ACR: <attached|not attached> · Artifacts: <count>]`

## .gitignore

On first write, ensure `.kickstart/` is in `.gitignore`:

```bash
grep -qxF '.kickstart/' .gitignore 2>/dev/null || echo '.kickstart/' >> .gitignore
```

## Reset / Resume

- **Resume**: read `state.json`, jump to the phase named in `phase`.
- **Reset**: `rm -rf .kickstart/` and restart `kickstart` agent.
