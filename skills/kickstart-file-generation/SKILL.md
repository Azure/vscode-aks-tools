---
name: kickstart-file-generation
description: Rules for batching edit/editFiles calls efficiently. Prevents chatty incremental file writes and ensures the artifact store is updated atomically per logical unit of work.
disable-model-invocation: true
---

# File Generation Batching

When generating multiple related files, write them all before reporting to the user. Do not write one file, report, write another file, report — this creates noise and the user has no useful intermediate state to act on.

## The rule

**Compute all file contents in a single reasoning pass. Then write all files. Then report.**

```
THINK: what files are needed and what goes in each
WRITE: file 1, file 2, file 3, … (consecutive edit/editFiles calls)
REPORT: "I generated the following files: …"
```

## Batching boundaries

A "batch" is all files that belong to the same logical unit of work:
- All infrastructure files for a single stack: batch together
- All Kubernetes manifests for a single workload: batch together
- The Dockerfile and the CI workflow that builds from it: batch together

Do **not** batch files across unrelated features or stacks into a single turn — that makes validation harder.

## Pre-generation checklist

Before writing any file:
1. List all the files you intend to write (in your reasoning, not in the chat output).
2. Confirm each file has a unique path and does not collide with an existing artifact.
3. Check that the content of file N+1 does not depend on values only known after writing file N.

If there are dependencies between files (e.g., the K8s deployment references an image tag that comes from the Bicep output), resolve those values before writing either file.

## Partial failures

If a edit/editFiles call fails mid-batch:
1. Stop the batch.
2. Report which files were written successfully and which were not.
3. Do not retry automatically — wait for the user to confirm intent before continuing.

## Overwriting existing files

Before overwriting an existing file in the artifact store, announce your intent:
> "I'm about to overwrite `k8s/deployment.yaml` — it already exists. Proceeding."

Do not silently overwrite without announcement.

## File size limits

Keep generated files under 100 KB each. If a single file would exceed this, split it into multiple files with clear naming (e.g., `main.bicep` + `modules/aks.bicep`).
