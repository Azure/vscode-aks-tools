# AI Data Flow and Privacy

This page documents how Container Assist uses AI models, what data from your project is sent to cloud AI services, what data stays local, and the security protections in place.

## Architecture: Local Analysis + Cloud AI Generation

Container Assist uses a two-phase architecture:

1. **Phase 1 -- Local analysis (no network calls):** The `containerization-assist-mcp/sdk` runs entirely on your machine. It scans your project filesystem to detect languages, frameworks, dependencies, ports, and entry points. No data leaves your machine during this phase.

2. **Phase 2 -- Cloud AI generation:** The SDK's analysis results are formatted into prompts and sent to a VS Code Language Model (via the `vscode.lm` API) to generate Dockerfiles and Kubernetes manifests. This phase involves cloud AI calls.


## What AI Models Are Used

| Setting | Default | Description |
|---------|---------|-------------|
| `aks.containerAssist.modelFamily` | `gpt-5.2-codex` | The model family to use |
| `aks.containerAssist.modelVendor` | `copilot` | The model vendor (provider) |

- Container Assist uses the **VS Code Language Model API** (`vscode.lm`), which routes requests through GitHub Copilot's infrastructure.
- On launch, you can choose "Use Default Model" or "Select Model..." to pick from any available VS Code language model.
- If the configured default model is not found, the first available model is used as a fallback.

## What Data Is Sent to the AI Model

### Per-Interaction Overview

Container Assist makes **two AI calls per module** in your project:

1. **Dockerfile generation** -- one AI call
2. **Kubernetes manifest generation** -- one AI call

Each call includes a system prompt, a user prompt, and tool definitions. The AI may then invoke tools to read additional files from your project (up to 20 rounds of tool calls per interaction).

### System Prompts (Static, Hardcoded)

The system prompts are fixed strings that describe the AI's role and workflow. They do not contain any of your project data. They instruct the AI to:
- Act as an expert at creating Dockerfiles or Kubernetes manifests
- Use tools (`readProjectFile`, `listDirectory`) to verify project details before generating
- Output content in a specific `<content>` marker format

### User Prompts (Contain Project Data)

The user prompt is built from the local SDK analysis and includes:

**For Dockerfile generation:**
- Detected programming language (e.g., "typescript", "python", "java")
- Framework names and versions (e.g., "Express v4.18.0")
- Entry point path (e.g., "src/index.ts")
- Detected ports (e.g., "3000, 8080")
- First 15 dependency names (e.g., "express, pg, redis, ...")
- SDK recommendations: build strategy, base image suggestions, security considerations, optimizations
- Existing Dockerfile content (if present), including analysis and enhancement guidance
- Language-specific verification hints (what config files to check)

**For Kubernetes manifest generation:**
- All of the above, plus:
- Application name (e.g., "my-app")
- Target Kubernetes namespace
- Full image repository URL (e.g., `myacr.azurecr.io/my-app`)

### Tool Calls (AI Reads Your Files)

During generation, the AI can invoke two tools to inspect your project:

#### `readProjectFile`

Reads a file from your project. The AI decides which files to read based on the analysis.

- **Input:** Relative file path, optional line limit
- **Output:** File content (up to 200 lines)
- **Typical files read:** `package.json`, `tsconfig.json`, `pom.xml`, `Dockerfile`, `go.mod`, source entry points, configuration files

#### `listDirectory`

Lists files and subdirectories in your project.

- **Input:** Relative directory path, optional max depth
- **Output:** Tree listing of files and directories (up to 200 entries, max 3 levels deep)
- **Excluded from listings:** `node_modules`, `.git`, `dist`, `build`, `target`, `bin`, `obj`, `__pycache__`, `venv`, `.next`, `.nuxt`

The AI can make up to **20 rounds** of tool calls per interaction. In each round, it may call multiple tools concurrently. After 20 rounds, a final request is sent without tools to force the AI to produce its output.

## What Data Is NOT Sent

### Blocked Sensitive Files

The following files are **blocked from being read** by the AI, even if it requests them:

| Pattern | Examples |
|---------|----------|
| `.env`, `.env.local`, `.env.production`, `.env.staging` | Environment variable files |
| `*.pem`, `*.key`, `*.pfx`, `*.p12` | TLS/SSL certificates and private keys |
| `credentials*` | Credential files (any extension) |
| `secret.*`, `secrets.*`, `.secrets` | Secret configuration files |
| `id_rsa`, `id_ed25519` | SSH private keys |
| `*.secret` | Any file with `.secret` extension |

If the AI requests a blocked file, the tool returns an error and the AI must proceed without that file's content.

### Path Traversal Protection

All file access tools enforce strict path boundaries:

- **`..` path segments** are rejected (no escaping the project root)
- **Absolute paths** are rejected
- **Windows drive paths** and **UNC paths** are rejected
- The resolved path is verified to remain within the workspace root

### What Stays Entirely Local

The following data is processed locally and **never sent to any AI model**:

- Your Azure subscription, cluster, ACR, and namespace selections
- Managed identity details, role assignments, federated credentials
- GitHub repository secrets
- Git history and commit data
- The workflow YAML template (generated from a local template, not AI)
- File write operations (Dockerfile, manifests, workflow files)

## Summary: Data Flow by Destination

| Destination | Data |
|-------------|------|
| **Local only (no network)** | Full project filesystem scan, Azure resource operations, role assignments, GitHub secrets, workflow template rendering, file writes |
| **VS Code Language Model API (cloud)** | SDK analysis summaries (language, framework, ports, dependencies, entry point), project file contents requested by AI tools, system prompts |
| **Not sent (blocked)** | `.env` files, private keys, certificates, credential files, SSH keys, secret files |
