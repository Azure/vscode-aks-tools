import * as vscode from "vscode";
import * as path from "path";
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
            result.dockerfilePath = dockerfilePaths[0];
            logger.debug("Found existing Dockerfile(s)", dockerfilePaths);
        }

        // Check for K8s manifests
        const manifests = await scanForK8sManifests(folderPath);

        if (manifests.length > 0) {
            result.hasK8sManifests = true;
            result.k8sManifestPaths = manifests;
        } else {
            logger.debug("No K8s manifests found in project");
        }
    } catch (error) {
        logger.error("Error checking existing files", error);
    }

    return result;
}

/**
 * Searches recursively (up to maxDepth levels) for Dockerfiles under rootPath.
 * Returns absolute paths sorted shallowest-first; excluded dirs are skipped.
 */
export async function scanForDockerfiles(rootPath: string, maxDepth: number = 3): Promise<string[]> {
    const found: string[] = [];
    await scanForDockerfilesRecursive(rootPath, found, maxDepth, 0);
    // Sort shallowest first
    found.sort((a, b) => {
        const aDepth = a.split(path.sep).length;
        const bDepth = b.split(path.sep).length;
        return aDepth - bDepth;
    });
    return found;
}

const DOCKERFILE_EXCLUDED_DIRS = new Set([
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
]);

async function scanForDockerfilesRecursive(
    dirPath: string,
    found: string[],
    maxDepth: number,
    currentDepth: number,
): Promise<void> {
    if (currentDepth > maxDepth) {
        return;
    }

    try {
        const dirStat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
        if (dirStat.type !== vscode.FileType.Directory) {
            return;
        }

        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));

        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && name === "Dockerfile") {
                found.push(path.join(dirPath, name));
            } else if (type === vscode.FileType.Directory && !DOCKERFILE_EXCLUDED_DIRS.has(name)) {
                await scanForDockerfilesRecursive(path.join(dirPath, name), found, maxDepth, currentDepth + 1);
            }
        }
    } catch {
        // Directory doesn't exist or can't be read — skip silently
    }
}

/**
 * Unified scanner for K8s manifests with single-pass directory traversal
 * Searches common locations first, then falls back to shallow recursive scan
 */
export async function scanForK8sManifests(rootPath: string): Promise<string[]> {
    const manifestSet = new Set<string>();

    // Common K8s manifest folders (checked first for performance)
    const priorityFolders = [
        getK8sManifestFolder(), // User-configured or default "k8s"
        "manifests",
        "kubernetes",
        "deploy",
        "deployment",
        ".kube",
        "charts",
        "config",
        "infra",
        "infrastructure",
    ];

    // Check priority folders
    for (const folder of priorityFolders) {
        const folderPath = path.join(rootPath, folder);
        await scanDirectory(folderPath, manifestSet, false);
    }

    // Check root directory for loose manifests
    await scanDirectory(rootPath, manifestSet, false);

    // If nothing found, do shallow recursive search (max 2 levels)
    if (manifestSet.size === 0) {
        logger.debug("No manifests in common locations, performing shallow recursive search");
        await scanDirectoryRecursive(rootPath, manifestSet, 2, 0);
    }

    return Array.from(manifestSet);
}

/**
 * Scans a single directory for K8s manifests (non-recursive)
 */
async function scanDirectory(dirPath: string, manifestSet: Set<string>, isRecursive: boolean): Promise<void> {
    try {
        const dirStat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
        if (dirStat.type !== vscode.FileType.Directory) {
            return;
        }

        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));

        const fileChecks = entries
            .filter(
                ([name, type]) => type === vscode.FileType.File && (name.endsWith(".yaml") || name.endsWith(".yml")),
            )
            .map(async ([name]) => {
                const fullPath = path.join(dirPath, name);
                if (await isKubernetesManifest(fullPath)) {
                    manifestSet.add(fullPath);
                    if (!isRecursive) {
                        logger.debug(`Found K8s manifest: ${fullPath}`);
                    }
                }
            });

        await Promise.all(fileChecks);
    } catch {
        // Directory doesn't exist or can't be read - skip silently
    }
}

/**
 * Recursively scans directories for K8s manifests up to specified depth
 */
async function scanDirectoryRecursive(
    dirPath: string,
    manifestSet: Set<string>,
    maxDepth: number,
    currentDepth: number,
): Promise<void> {
    if (currentDepth > maxDepth) {
        return;
    }

    try {
        const dirStat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
        if (dirStat.type !== vscode.FileType.Directory) {
            return;
        }

        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));

        for (const [name, type] of entries) {
            if (DOCKERFILE_EXCLUDED_DIRS.has(name)) {
                continue;
            }

            const fullPath = path.join(dirPath, name);

            if (type === vscode.FileType.File && (name.endsWith(".yaml") || name.endsWith(".yml"))) {
                if (await isKubernetesManifest(fullPath)) {
                    manifestSet.add(fullPath);
                }
            } else if (type === vscode.FileType.Directory) {
                await scanDirectoryRecursive(fullPath, manifestSet, maxDepth, currentDepth + 1);
            }
        }
    } catch (error) {
        logger.debug(`Skipping directory ${dirPath}:`, error);
    }
}

/**
 * Validates if a YAML file is a Kubernetes manifest
 */
async function isKubernetesManifest(filePath: string): Promise<boolean> {
    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const previewSize = Math.min(content.length, 1024);
        const text = Buffer.from(content.slice(0, previewSize)).toString("utf-8");

        // Must have both apiVersion and kind
        const hasApiVersion = /^apiVersion:\s*.+$/m.test(text);
        if (!hasApiVersion) {
            return false;
        }

        // Extract kind value — must be present and PascalCase
        const kindMatch = text.match(/^kind:\s*([A-Z]\w*)$/m);
        if (!kindMatch) {
            return false;
        }

        const kind = kindMatch[1].trim();

        return /^[A-Z][a-zA-Z0-9]*$/.test(kind);
    } catch (error) {
        logger.debug(`Failed to validate manifest ${filePath}`, error);
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

    logger.debug("Ensured .github/workflows directory", workflowsDir);
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
