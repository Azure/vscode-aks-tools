---
name: kickstart-discover
description: "Discovery phase playbook — collect application details to propose an architecture."
disable-model-invocation: true
---

# Discover Phase

Collect enough information about the user's application to propose a deployment architecture. Use `vscode_askQuestions` for every question — present choices whenever possible.

## What to Collect

| Item | How to get it |
|------|--------------|
| App name | `vscode_askQuestions` with `allowFreeformInput: true` |
| Language / framework | Infer from workspace files first, then confirm via `vscode_askQuestions` with detected options |
| Dependencies | `vscode_askQuestions` multi-select: databases, caches, queues, external APIs |
| Port | Infer from code, confirm via `vscode_askQuestions` with detected value + "Other" |
| Environment variables | Infer from `.env.example` / code, confirm via `vscode_askQuestions` |
| Existing Dockerfile | Search workspace — no question needed |
| Existing CI/CD | Search workspace — no question needed |
| Source repo | Infer from git remote — no question needed |

## Conversation Strategy

- **Always use `vscode_askQuestions`** to collect information. Never ask questions in plain markdown and wait for free-text replies.
- Before asking, use `search` and `codebase` tools to auto-detect answers. Then present what you found as pre-selected options for confirmation.
- Ask one question at a time. Each `vscode_askQuestions` call should have one focused question with concrete options.
- When the answer space is bounded (language, framework, database type), provide a curated option list. Mark the detected/recommended option with `recommended: true`.
- When the answer is open-ended (app name, custom port), use `allowFreeformInput: true`.

### Example — Language Detection

After scanning the workspace and finding `package.json`:
```json
{
  "questions": [{
    "header": "Framework",
    "question": "I found a package.json — which framework does your app use?",
    "options": [
      { "label": "Express.js", "recommended": true },
      { "label": "Next.js" },
      { "label": "Fastify" },
      { "label": "NestJS" }
    ],
    "allowFreeformInput": true
  }]
}
```

### Example — Dependencies

```json
{
  "questions": [{
    "header": "Dependencies",
    "question": "Which backing services does your app need?",
    "multiSelect": true,
    "options": [
      { "label": "PostgreSQL" },
      { "label": "Redis" },
      { "label": "Azure Service Bus" },
      { "label": "Azure Blob Storage" },
      { "label": "MongoDB" },
      { "label": "None" }
    ]
  }]
}
```

## Exit Criteria

You have enough to proceed when you know:
- [ ] App name
- [ ] Language and framework
- [ ] Port
- [ ] Key dependencies
- [ ] Environment variables (at least which ones exist)
- [ ] Whether a Dockerfile exists
- [ ] Whether CI/CD exists

When all items are collected, announce: "Discovery complete — ready to move to the Design phase."
