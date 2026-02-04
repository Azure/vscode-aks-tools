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
    await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath),
        Buffer.from(content, "utf-8"),
    );
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
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(dockerfilePath));
            result.hasDockerfile = true;
            result.dockerfilePath = dockerfilePath;
            logger.debug("Found existing Dockerfile", dockerfilePath);
        } catch {
            // Dockerfile doesn't exist
        }

        const k8sFolder = path.join(folderPath, getK8sManifestFolder());
        try {
            const k8sStat = await vscode.workspace.fs.stat(vscode.Uri.file(k8sFolder));
            if (k8sStat.type === vscode.FileType.Directory) {
                const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(k8sFolder));
                const yamlFiles = files
                    .filter(([name, type]) => type === vscode.FileType.File && (name.endsWith(".yaml") || name.endsWith(".yml")))
                    .map(([name]) => path.join(k8sFolder, name));
                
                if (yamlFiles.length > 0) {
                    result.hasK8sManifests = true;
                    result.k8sManifestPaths = yamlFiles;
                    logger.debug("Found existing K8s manifests", yamlFiles);
                }
            }
        } catch {
            // K8s folder doesn't exist
        }
    } catch (error) {
        logger.error("Error checking existing files", error);
    }

    return result;
}
