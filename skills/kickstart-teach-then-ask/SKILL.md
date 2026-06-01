---
name: kickstart-teach-then-ask
description: Interaction pattern that requires agents to briefly explain context or reasoning before asking the user a question. Reduces cognitive load and builds trust.
disable-model-invocation: true
---

# Teach Then Ask

Before asking the user a question, give them just enough context to answer confidently. A user who understands why you are asking will give a better answer — and trust you more.

**Always use `vscode_askQuestions` to present the question.** The teach context goes in the `message` field; the choices go in `options`.

## The pattern

1. Put a one-sentence explanation in the `message` field of the question.
2. Present concrete options whenever the answer space is bounded.
3. Mark the recommended option with `recommended: true`.
4. Set `allowFreeformInput: true` only when the user might have an answer outside your option list.

### Example — bad

Asking in plain markdown and waiting for free text:
> "What region do you want to deploy to?"

### Example — good

```json
{
  "questions": [{
    "header": "Region",
    "question": "Which Azure region is closest to your primary users?",
    "message": "Azure resources are deployed to a geographic region that affects latency for your users and data residency compliance.",
    "options": [
      { "label": "East US", "description": "Virginia", "recommended": true },
      { "label": "West Europe", "description": "Netherlands" },
      { "label": "Southeast Asia", "description": "Singapore" }
    ],
    "allowFreeformInput": true
  }]
}
```

## When to apply

Apply this pattern whenever you ask a question that:
- Involves a technical decision the user may not have thought through before
- Has non-obvious trade-offs (cost vs latency, durability vs speed)
- Could be answered differently depending on context you haven't shared

## When NOT to apply

Skip the `message` preamble (but still use `vscode_askQuestions`) when:
- The user has already demonstrated knowledge of the topic
- The question is a routine follow-up with obvious context ("What is your app's name?")
- You are deep in a back-and-forth and the context is already established

## One question at a time

Never batch multiple questions into one `vscode_askQuestions` call unless they are tightly related (e.g., resource group name + region). If you need five answers, ask the most blocking question first, then proceed sequentially. This feels like a conversation, not a form.

## Acknowledging the answer

After the user answers, briefly confirm you understood before moving on:
> "Got it — deploying to West Europe. Setting up the plan now."

This closes the loop and prevents the user from wondering if their answer was received.
