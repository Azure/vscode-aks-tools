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
        const dockerfilePath = path.join(folderPath, "Dockerfile");
        if (await fileExists(dockerfilePath)) {
            result.hasDockerfile = true;
            result.dockerfilePath = dockerfilePath;
            logger.debug("Found existing Dockerfile", dockerfilePath);
        }

        // Check for K8s manifests
        const k8sFolder = path.join(folderPath, getK8sManifestFolder());
        const yamlFiles = await findYamlFiles(k8sFolder);
        if (yamlFiles.length > 0) {
            result.hasK8sManifests = true;
            result.k8sManifestPaths = yamlFiles;
            logger.debug("Found existing K8s manifests", yamlFiles);
        }
    } catch (error) {
        logger.error("Error checking existing files", error);
    }

    return result;
}

async function findYamlFiles(dirPath: string): Promise<string[]> {
    try {
        const dirStat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
        if (dirStat.type !== vscode.FileType.Directory) {
            return [];
        }

        const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
        return files
            .filter(
                ([name, type]) => type === vscode.FileType.File && (name.endsWith(".yaml") || name.endsWith(".yml")),
            )
            .map(([name]) => path.join(dirPath, name));
    } catch {
        return [];
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
export async function writeWorkflowFile(
    workspacePath: string,
    workflowName: string,
    content: string,
): Promise<string> {
    const workflowsDir = await ensureGitHubWorkflowsDirectory(workspacePath);
    const workflowPath = path.join(workflowsDir, `${workflowName}.yml`);

    await writeFile(workflowPath, content);
    logger.info(`Workflow file created: ${workflowPath}`);

    return workflowPath;
}
