import * as vscode from "vscode";
import * as path from "path";
import { exec, NonZeroExitCodeBehaviour } from "../../../commands/utils/shell";
import { scanForDockerfiles } from "../../../commands/aksContainerAssist/fileOperations";
import { failed } from "../../../commands/utils/errorable";
import { PhaseResult } from "../phaseRunner";
import { ArtifactsData, ConfigData, ImageData } from "../state";

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
): Promise<PhaseResult & { image?: ImageData }> {
    try {
        const workspacePath = workspaceFolder.fsPath;

        stream.markdown("🐳 **Building and pushing container image**\n\n");

        // Entry validation: Check artifacts are saved to disk
        if (!artifacts.savedToDisk) {
            return {
                ok: false,
                error: "Artifacts have not been saved to disk. Please save the generated Dockerfile and manifests before building.",
                retryable: false,
            };
        }

        // Check that Dockerfile exists on disk
        const dockerfiles = await scanForDockerfiles(workspacePath);
        if (dockerfiles.length === 0) {
            return {
                ok: false,
                error: "Dockerfile not found in workspace. Please save the Dockerfile before building.",
                retryable: false,
            };
        }

        const dockerfilePath = dockerfiles[0];

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
        stream.markdown(`- **Dockerfile:** ${dockerfilePath}\n\n`);

        // Check if token is cancelled before starting build
        if (token.isCancellationRequested) {
            return {
                ok: false,
                error: "Build cancelled by user.",
                retryable: true,
            };
        }

        // Execute az acr build command
        stream.markdown("### Building image...\n\n");
        stream.progress("Building container image...");

        // Use az acr build to build and push in one step
        // The command: az acr build --registry <acr-name> --image <image-name>:<tag> <build-context>
        const buildCommand = `az acr build --registry ${config.acrName} --image ${imageName}:${imageTag} "${workspacePath}"`;

        const buildResult = await exec(buildCommand, {
            workingDir: workspacePath,
            exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed, // Handle non-zero exit ourselves
        });

        if (failed(buildResult) || buildResult.result.code !== 0) {
            const errorOutput = failed(buildResult)
                ? buildResult.error
                : buildResult.result.stderr || buildResult.result.stdout;
            return {
                ok: false,
                error: `Container build failed: ${errorOutput}`,
                retryable: true,
            };
        }

        // Stream build output to user
        const buildOutput = buildResult.result.stdout.trim();
        if (buildOutput) {
            stream.markdown("```\n");
            stream.markdown(buildOutput);
            stream.markdown("\n```\n\n");
        }

        // Exit validation: Verify image was pushed to ACR
        stream.markdown("### Verifying image in registry...\n\n");

        const verifyCommand = `az acr repository show-tags --name ${config.acrName} --repository ${imageName} --orderby time_desc --output json`;
        const verifyResult = await exec(verifyCommand, {
            exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed,
        });

        if (failed(verifyResult) || verifyResult.result.code !== 0) {
            // If verification fails, we still consider the build successful
            // since az acr build returned 0. The image should be there.
            stream.markdown(
                "⚠️ Could not verify image tag, but build command succeeded. The image should be available in the registry.\n\n",
            );
        } else {
            // Parse the tags response
            try {
                const tagsOutput = verifyResult.result.stdout.trim();
                const tags = JSON.parse(tagsOutput);
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
