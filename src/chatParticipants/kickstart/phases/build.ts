import * as vscode from "vscode";
import * as path from "path";
import { scanForDockerfiles } from "../../../commands/aksContainerAssist/fileOperations";
import { PhaseResult } from "../phaseRunner";
import { ArtifactsData, ConfigData, ImageData } from "../state";
import { StagedFileManager } from "../stagedFileManager";
import { runInTerminal } from "../terminalTool";

/**
 * Builds and pushes a container image to Azure Container Registry (ACR).
 *
 * This phase:
 * 1. Validates that artifacts have been saved to disk (Dockerfile exists)
 * 2. Validates ACR login server is configured
 * 3. Determines image name and tag from workspace folder
 * 4. Streams build progress to the user
 * 5. Uses `az acr build` to build and push the image
 * 6. Verifies the pushed image exists in the registry
 * 7. Returns ImageData with repository and tag for next phase
 *
 * @param workspaceFolder The workspace folder URI
 * @param artifacts Project artifacts (Dockerfile and manifests) from PREPARE phase
 * @param config Cluster and registry configuration from CONFIGURE phase
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @returns PhaseResult with ImageData on success
 */
export async function buildPhase(
    workspaceFolder: vscode.Uri,
    artifacts: ArtifactsData,
    config: ConfigData,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    request: vscode.ChatRequest,
    storageUri?: vscode.Uri,
): Promise<PhaseResult & { image?: ImageData }> {
    try {
        const workspacePath = workspaceFolder.fsPath;

        stream.markdown("🐳 **Building and pushing container image**\n\n");

        // Resolve the build context directory.
        // If the user has already saved artifacts to disk, build from the workspace.
        // Otherwise build from the extension's staging directory, which was already
        // written during the Prepare phase (no re-write needed).
        let buildContextPath: string;

        if (artifacts.savedToDisk) {
            buildContextPath = workspacePath;
        } else {
            if (!storageUri) {
                return {
                    ok: false,
                    error: "No staged artifacts found. Please run the Prepare phase first.",
                    retryable: false,
                };
            }
            const stagingRoot = new StagedFileManager(storageUri).stagingRoot;
            buildContextPath = stagingRoot.fsPath;
            stream.markdown("ℹ️ Building from staged files (artifacts not yet saved to workspace).\n\n");
        }

        // Check that Dockerfile exists in the build context
        const dockerfiles = await scanForDockerfiles(buildContextPath);
        if (dockerfiles.length === 0) {
            return {
                ok: false,
                error: "Dockerfile not found. Please run the Prepare phase to generate one.",
                retryable: false,
            };
        }

        // Validate ACR configuration
        if (!config.acrName || !config.acrLoginServer) {
            return {
                ok: false,
                error: "ACR registry not configured. Please complete the Configuration phase.",
                retryable: false,
            };
        }

        // Determine image name from workspace folder
        const workspaceFolderName = path.basename(workspacePath);
        const imageName = workspaceFolderName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const imageTag = "latest";
        const fullImageUri = `${config.acrLoginServer}/${imageName}:${imageTag}`;

        // Show build preview
        stream.markdown("### Build Configuration\n\n");
        stream.markdown(`- **ACR:** ${config.acrName} (${config.acrLoginServer})\n`);
        stream.markdown(`- **Image Name:** ${imageName}\n`);
        stream.markdown(`- **Image Tag:** ${imageTag}\n`);
        stream.markdown(`- **Full URI:** ${fullImageUri}\n`);
        stream.markdown(`- **Dockerfile:** ${dockerfiles[0]}\n\n`);

        // Check if token is cancelled before starting build
        if (token.isCancellationRequested) {
            return {
                ok: false,
                error: "Build cancelled by user.",
                retryable: true,
            };
        }

        stream.markdown("### Building image...\n\n");
        stream.progress("Building container image...");

        const buildCommand = `az acr build --registry ${config.acrName} --image ${imageName}:${imageTag} .`;

        const buildResult = await runInTerminal(buildCommand, buildContextPath, token, request.toolInvocationToken);

        if (!buildResult.succeeded) {
            return {
                ok: false,
                error: `Container build failed: ${buildResult.error}`,
                retryable: true,
            };
        }

        stream.markdown("### Verifying image in registry...\n\n");

        const verifyCommand = `az acr repository show-tags --name ${config.acrName} --repository ${imageName} --orderby time_desc --output json`;
        const verifyResult = await runInTerminal(verifyCommand, buildContextPath, token, request.toolInvocationToken);

        if (!verifyResult.succeeded) {
            stream.markdown(
                "⚠️ Could not verify image tag, but build command succeeded. The image should be available in the registry.\n\n",
            );
        } else {
            try {
                const tags = JSON.parse(verifyResult.result);
                if (Array.isArray(tags) && tags.includes(imageTag)) {
                    stream.markdown(`✅ Image verified in registry: **${imageName}:${imageTag}**\n\n`);
                } else {
                    stream.markdown(
                        `⚠️ Tag '${imageTag}' not found in recent tags. The image may take a moment to appear in the registry.\n\n`,
                    );
                }
            } catch {
                stream.markdown("ℹ️ Image build completed. Tag verification parsing skipped.\n\n");
            }
        }

        // Build successful
        stream.markdown("### Summary\n\n");
        stream.markdown(`✅ **Build and push complete!**\n`);
        stream.markdown(`- **Repository:** ${config.acrLoginServer}/${imageName}\n`);
        stream.markdown(`- **Tag:** ${imageTag}\n`);
        stream.markdown(`- **Full Reference:** ${fullImageUri}\n\n`);

        stream.markdown("### Next Steps\n\n");
        stream.markdown("1. Your container image is now available in Azure Container Registry\n");
        stream.markdown("2. Proceed to the **Deploy** phase to apply Kubernetes manifests to your cluster\n");

        const image: ImageData = {
            repository: `${config.acrLoginServer}/${imageName}`,
            tag: imageTag,
        };

        return {
            ok: true,
            image,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Build phase failed: ${message}`,
            retryable: true,
        };
    }
}
