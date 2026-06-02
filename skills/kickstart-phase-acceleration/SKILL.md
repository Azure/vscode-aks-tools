---
name: kickstart-phase-acceleration
description: Rules for when agents may skip confirmations, condense phases, or proceed autonomously. Prevents unnecessary friction when context is sufficient to proceed confidently.
disable-model-invocation: true
---

# Phase Acceleration

Not every step requires explicit user confirmation. When context is unambiguous and the action is reversible, proceed. When context is missing or the action is irreversible, stop and confirm.

## Default behaviour

**Proceed without asking when all of the following are true:**
1. The user's intent is unambiguous (they said "generate" or "create" and you have all required inputs).
2. The operation is reversible (files can be regenerated; no external calls have been made).
3. No previous step in this session ended in an error that suggests misalignment.

**Stop and confirm when any of the following is true:**
1. An input is missing and there is no reasonable default.
2. The operation is irreversible (deploying to production, deleting resources, sending external requests).
3. The user has corrected you at least once in this session — their tolerance for autonomous action is lower.
4. A guardrail flagged the proposed action.

## Phase condensing

When the user provides all inputs up-front (e.g., "Create a Node.js API with a Dockerfile and a GitHub Actions workflow for Azure"), you may execute multiple phases in a single turn without asking for confirmation between them:

1. Plan → 2. Generate → 3. Validate → 4. Report

Announce what you are about to do at the start: "I have everything I need — generating plan, files, and validating in one pass."

## Interruption points

Even in accelerated mode, always pause before:
- Overwriting a file that already exists in the artifact store
- Emitting a UI surface that replaces a surface the user was actively viewing
- Making a network request (fetch_webpage) to an unfamiliar domain

## Communicating acceleration

When you skip a confirmation step, briefly note it:
> "Skipping the review step — the validation passed cleanly. Here are your files."

Do not silently skip steps. The user should always know what happened.
