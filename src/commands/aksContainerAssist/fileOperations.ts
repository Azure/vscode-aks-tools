import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { ExistingFilesCheckResult } from "./types";
import { logger } from "./logger";

export const DEFAULT_K8S_MANIFESTS_FOLDER = "k8s";

export function getK8sManifestFolder(): string {
    const config = vscode.workspace.getConfiguration("aks.containerAssist");
    return config.get<string>("k8sManifestFolder", DEFAULT_K8S_MANIFESTS_FOLDER);
}

export async function writeFile(filePath: string, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(content, "utf-8"));
}

export async function ensureDirectory(dirPath: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return true;
    } catch {
        return false;
    }
}

export async function checkExistingFiles(folderPath: string): Promise<ExistingFilesCheckResult> {
    const result: ExistingFilesCheckResult = {
        hasDockerfile: false,
        hasK8sManifests: false,
    };

    try {
        // Search recursively so Dockerfiles in subdirectories (e.g. src/web/Dockerfile) are found.
        const dockerfilePaths = await scanForDockerfiles(folderPath);
        if (dockerfilePaths.length > 0) {
            result.hasDockerfile = true;
            result.dockerfilePaths = dockerfilePaths;
        }

        // Check for K8s manifests
        const manifests = await scanForK8sManifests(folderPath);

        if (manifests.length > 0) {
            result.hasK8sManifests = true;
            result.k8sManifestPaths = manifests;
        }
    } catch (error) {
        logger.error("Error checking existing files", error);
    }

    return result;
}

/** Directories to skip during recursive scans (build artifacts, dependencies, etc.) */
const EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    "vendor",
    ".vscode",
    "coverage",
    "target",
    ".next",
    ".nuxt",
    "__pycache__",
    "venv",
    ".env",
    "bin",
    "obj",
    ".terraform",
    ".gradle",
    ".idea",
    ".settings",
    ".mvn",
]);

/** Maximum directory depth for Dockerfile and manifest scanning. */
const SCAN_MAX_DEPTH = 3;

/**
 * Searches recursively (up to 3 levels deep) for Dockerfiles under rootPath.
 * Returns absolute paths sorted shallowest-first; excluded dirs are skipped.
 */
export async function scanForDockerfiles(rootPath: string): Promise<string[]> {
    const dockerfiles: string[] = [];

    const isDockerfile = (_filePath: string, fileName: string): boolean => fileName === "Dockerfile";

    await walkDirectory(rootPath, SCAN_MAX_DEPTH, 0, (filePath, fileName) => {
        if (isDockerfile(filePath, fileName)) {
            dockerfiles.push(filePath);
        }
    });

    return dockerfiles.sort((left, right) => left.split(path.sep).length - right.split(path.sep).length);
}

/**
 * Scans for K8s manifests up to 3 levels deep under rootPath.
 * Validates each .yaml/.yml file has apiVersion + kind to avoid false positives.
 * Returns absolute paths.
 */
export async function scanForK8sManifests(rootPath: string): Promise<string[]> {
    const manifests: string[] = [];

    const isYamlFile = (fileName: string): boolean => fileName.endsWith(".yaml") || fileName.endsWith(".yml");

    await walkDirectory(rootPath, SCAN_MAX_DEPTH, 0, async (filePath, fileName) => {
        if (!isYamlFile(fileName)) {
            return;
        }

        if (await isKubernetesManifest(filePath)) {
            manifests.push(filePath);
        }
    });

    return manifests;
}

/**
 * Generic depth-limited directory walker. Calls `onFile` for each file found.
 * Skips excluded directories. The callback can be async.
 * Uses Node.js fs/promises for reliable performance across all environments.
 */
async function walkDirectory(
    dirPath: string,
    maxDepth: number,
    currentDepth: number,
    onFile: (filePath: string, name: string) => void | Promise<void>,
): Promise<void> {
    if (currentDepth > maxDepth) {
        return;
    }

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isFile()) {
                await onFile(fullPath, entry.name);
            } else if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
                await walkDirectory(fullPath, maxDepth, currentDepth + 1, onFile);
            }
        }
    } catch {
        // Directory doesn't exist or can't be read — skip silently
    }
}

/**
 * Validates if a YAML file is a Kubernetes manifest.
 * Handles both LF and CRLF line endings.
 * Uses Node.js fs/promises for reliable performance across all environments.
 */
async function isKubernetesManifest(filePath: string): Promise<boolean> {
    try {
        const handle = await fs.open(filePath, "r");
        let text: string;
        try {
            const buffer = Buffer.alloc(1024);
            const { bytesRead } = await handle.read(buffer, 0, 1024, 0);
            text = buffer.slice(0, bytesRead).toString("utf-8");
        } finally {
            await handle.close();
        }

        // Must have both apiVersion and kind (\r? handles CRLF)
        const hasApiVersion = /^apiVersion:\s*.+$/m.test(text);
        if (!hasApiVersion) {
            return false;
        }

        // Extract kind value — must be present and PascalCase
        const kindMatch = text.match(/^kind:\s*([A-Z]\w*)\r?$/m);
        if (!kindMatch) {
            return false;
        }

        const kind = kindMatch[1];
        return /^[A-Z][a-zA-Z0-9]*$/.test(kind);
    } catch {
        return false;
    }
}

/**
 * Ensures the .github/workflows directory exists
 * @param workspacePath Root path of the workspace
 * @returns Path to the workflows directory
 */
export async function ensureGitHubWorkflowsDirectory(workspacePath: string): Promise<string> {
    const githubDir = path.join(workspacePath, ".github");
    const workflowsDir = path.join(githubDir, "workflows");

    await ensureDirectory(githubDir);
    await ensureDirectory(workflowsDir);

    return workflowsDir;
}

/**
 * Checks if a workflow file already exists
 * @param workspacePath Root path of the workspace
 * @param workflowName Name of the workflow file (without .yml extension)
 * @returns True if the workflow file exists
 */
export async function workflowFileExists(workspacePath: string, workflowName: string): Promise<boolean> {
    const workflowPath = path.join(workspacePath, ".github", "workflows", `${workflowName}.yml`);
    return await fileExists(workflowPath);
}

/**
 * Writes a workflow file to the .github/workflows directory
 * @param workspacePath Root path of the workspace
 * @param workflowName Name of the workflow file (without .yml extension)
 * @param content Workflow YAML content
 * @returns Path to the created workflow file
 */
export async function writeWorkflowFile(workspacePath: string, workflowName: string, content: string): Promise<string> {
    const workflowsDir = await ensureGitHubWorkflowsDirectory(workspacePath);
    const workflowPath = path.join(workflowsDir, `${workflowName}.yml`);

    await writeFile(workflowPath, content);

    // Also create an OIDC setup guide
    await writeOIDCSetupGuide(workspacePath);

    return workflowPath;
}

/**
 * Writes an OIDC setup guide file to help users configure authentication
 * @param workspacePath Root path of the workspace
 */
async function writeOIDCSetupGuide(workspacePath: string): Promise<void> {
    const oidcGuidePath = path.join(workspacePath, "GITHUB-OIDC-SETUP.md");

    // Only create if it doesn't exist
    if (await fileExists(oidcGuidePath)) {
        return;
    }

    const oidcGuideContent = `# GitHub Actions OIDC Setup for Azure

Your GitHub workflow has been generated and is ready to deploy to Azure! However, it requires **OIDC authentication** to securely connect to Azure without storing secrets.

## 🔐 Required: Set up OIDC Authentication

### Option 1: Use AKS VS Code Extension (Recommended)
1. Open the Command Palette (\`Ctrl+Shift+P\` / \`Cmd+Shift+P\`)
2. Run: "AKS: Setup OIDC for GitHub Actions"
3. Follow the prompts to create a managed identity and federated credentials
4. Copy the generated secrets to your GitHub repository

### Option 2: Manual Setup
Follow the [official GitHub guide](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-azure) to:

1. Create an Azure AD application
2. Create a managed identity or service principal  
3. Configure federated identity credentials
4. Add the following secrets to your GitHub repository:
   - \`AZURE_CLIENT_ID\`
   - \`AZURE_TENANT_ID\`
   - \`AZURE_SUBSCRIPTION_ID\`

## ⚠️ Without OIDC Setup

Your workflow **will fail** with authentication errors when trying to connect to Azure. The workflow uses \`azure/login@v2\` which requires these credentials.

## ✅ After OIDC Setup

Once configured, your workflow will:
- Build your container image
- Push to Azure Container Registry
- Deploy to your AKS cluster
- All without storing any secrets in your repository!

---
*This file was generated by the AKS VS Code Extension. You can delete it after setting up OIDC.*
`;

    await writeFile(oidcGuidePath, oidcGuideContent);
}
