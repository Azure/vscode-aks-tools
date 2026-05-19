import * as vscode from "vscode";
import * as path from "path";
import { scanForDockerfiles } from "../../../commands/aksContainerAssist/fileOperations";
import { PhaseResult } from "../phaseRunner";
import { ArtifactsData, ConfigData, ImageData } from "../state";
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

        // The build context is the directory containing the Dockerfile (the module
        // directory for monorepos, or the workspace root for single-module projects).
        // This ensures relative paths inside the Dockerfile (e.g. `COPY requirements.txt .`)
        // resolve against the module's source files rather than the workspace root.
        // When artifacts have not yet been saved to disk the generated Dockerfile
        // lives in the staging directory, so we pass its path via --file while still
        // using the workspace module directory as the build context.

        // Collect Dockerfile build targets. Monorepos have one Dockerfile per module
        // (staged as "<modulePath>/Dockerfile"); single-module projects have one
        // at the root (staged as "Dockerfile").
        interface BuildTarget {
            dockerfilePath: string;
            dockerfileFlag: string;
            imageName: string;
            contextPath: string;
        }

        const workspaceFolderName = path.basename(workspacePath);
        const sanitize = (s: string): string =>
            s
                .toLowerCase()
                .replace(/[^a-z0-9-]+/g, "-")
                .replace(/^-+|-+$/g, "");
        const baseImageName = sanitize(workspaceFolderName) || "app";

        const targets: BuildTarget[] = [];

        if (artifacts.savedToDisk) {
            // Dockerfiles are already in the workspace – let az acr build find them.
            const dockerfiles = await scanForDockerfiles(workspacePath);
            if (dockerfiles.length === 0) {
                return {
                    ok: false,
                    error: "Dockerfile not found. Please run the Prepare phase to generate one.",
                    retryable: false,
                };
            }
            for (const df of dockerfiles) {
                const relDir = path.relative(workspacePath, path.dirname(df));
                const isRoot = !relDir || relDir === ".";
                const suffix = isRoot ? "" : `-${sanitize(relDir.split(path.sep).join("-"))}`;
                targets.push({
                    dockerfilePath: df,
                    dockerfileFlag: isRoot ? "" : `--file "${df}"`,
                    imageName: `${baseImageName}${suffix}`,
                    contextPath: path.dirname(df),
                });
            }
        } else {
            if (!storageUri) {
                return {
                    ok: false,
                    error: "No staged artifacts found. Please run the Prepare phase first.",
                    retryable: false,
                };
            }
            const stagedDockerfiles = artifacts.stagedFiles.filter(
                (f) => f.filename === "Dockerfile" || f.filename.endsWith("/Dockerfile"),
            );
            if (stagedDockerfiles.length === 0) {
                return {
                    ok: false,
                    error: "Dockerfile not found. Please run the Prepare phase to generate one.",
                    retryable: false,
                };
            }
            for (const sf of stagedDockerfiles) {
                const fsPath = vscode.Uri.parse(sf.stagedPath).fsPath;
                const isRoot = sf.filename === "Dockerfile";
                const relDir = isRoot ? "" : sf.filename.substring(0, sf.filename.length - "/Dockerfile".length);
                const suffix = relDir ? `-${sanitize(relDir.replace(/\//g, "-"))}` : "";
                targets.push({
                    dockerfilePath: fsPath,
                    dockerfileFlag: `--file "${fsPath}"`,
                    imageName: `${baseImageName}${suffix}`,
                    contextPath: isRoot ? workspacePath : path.join(workspacePath, relDir),
                });
            }
            stream.markdown(
                `ℹ️ Building from staged Dockerfile${targets.length > 1 ? "s" : ""} with workspace source code.\n\n`,
            );
        }

        // Validate ACR configuration
        if (!config.acrName || !config.acrLoginServer) {
            return {
                ok: false,
                error: "ACR registry not configured. Please complete the Configuration phase.",
                retryable: false,
            };
        }

        const imageTag = "latest";

        if (targets.length > 1) {
            stream.markdown(`### Build Plan (${targets.length} images)\n\n`);
            for (const t of targets) {
                stream.markdown(
                    `- **${config.acrLoginServer}/${t.imageName}:${imageTag}** — \`${t.dockerfilePath}\`\n`,
                );
            }
            stream.markdown("\n");
        } else {
            const t = targets[0];
            stream.markdown("### Build Configuration\n\n");
            stream.markdown(`- **ACR:** ${config.acrName} (${config.acrLoginServer})\n`);
            stream.markdown(`- **Image Name:** ${t.imageName}\n`);
            stream.markdown(`- **Image Tag:** ${imageTag}\n`);
            stream.markdown(`- **Full URI:** ${config.acrLoginServer}/${t.imageName}:${imageTag}\n`);
            stream.markdown(`- **Dockerfile:** ${t.dockerfilePath}\n\n`);
        }

        // Check if token is cancelled before starting build
        if (token.isCancellationRequested) {
            return {
                ok: false,
                error: "Build cancelled by user.",
                retryable: true,
            };
        }

        let lastImageName = "";
        for (const target of targets) {
            if (token.isCancellationRequested) {
                return { ok: false, error: "Build cancelled by user.", retryable: true };
            }

            stream.markdown(`### Building image \`${target.imageName}:${imageTag}\`...\n\n`);
            stream.progress(`Building ${target.imageName}...`);

            const buildCommand =
                `az acr build --registry ${config.acrName} --image ${target.imageName}:${imageTag} --subscription ${config.subscriptionId} ${target.dockerfileFlag} .`.trimEnd();

            const buildResult = await runInTerminal(
                buildCommand,
                target.contextPath,
                token,
                request.toolInvocationToken,
            );

            if (!buildResult.succeeded) {
                return {
                    ok: false,
                    error: `Container build failed for ${target.imageName}: ${buildResult.error}`,
                    retryable: true,
                };
            }

            stream.markdown(`### Verifying image \`${target.imageName}\` in registry...\n\n`);

            const verifyCommand = `az acr repository show-tags --name ${config.acrName} --repository ${target.imageName} --subscription ${config.subscriptionId} --orderby time_desc --output json`;
            const verifyResult = await runInTerminal(
                verifyCommand,
                target.contextPath,
                token,
                request.toolInvocationToken,
            );

            if (!verifyResult.succeeded) {
                stream.markdown(
                    `⚠️ Could not verify image \`${target.imageName}\`, but build command succeeded. The image should be available in the registry.\n\n`,
                );
            } else {
                try {
                    const tags = JSON.parse(verifyResult.result);
                    if (Array.isArray(tags) && tags.includes(imageTag)) {
                        stream.markdown(`✅ Image verified in registry: **${target.imageName}:${imageTag}**\n\n`);
                    } else {
                        stream.markdown(
                            `⚠️ Tag '${imageTag}' not found in recent tags for **${target.imageName}**. The image may take a moment to appear.\n\n`,
                        );
                    }
                } catch {
                    stream.markdown(
                        `ℹ️ Image **${target.imageName}** build completed. Tag verification parsing skipped.\n\n`,
                    );
                }
            }

            lastImageName = target.imageName;
        }

        // Build successful
        stream.markdown("### Summary\n\n");
        if (targets.length > 1) {
            stream.markdown(`✅ **Built and pushed ${targets.length} images:**\n`);
            for (const t of targets) {
                stream.markdown(`- ${config.acrLoginServer}/${t.imageName}:${imageTag}\n`);
            }
            stream.markdown("\n");
        } else {
            const t = targets[0];
            stream.markdown(`✅ **Build and push complete!**\n`);
            stream.markdown(`- **Repository:** ${config.acrLoginServer}/${t.imageName}\n`);
            stream.markdown(`- **Tag:** ${imageTag}\n`);
            stream.markdown(`- **Full Reference:** ${config.acrLoginServer}/${t.imageName}:${imageTag}\n\n`);
        }

        stream.markdown("### Next Steps\n\n");
        stream.markdown("1. Your container image(s) are now available in Azure Container Registry\n");
        stream.markdown("2. Proceed to the **Deploy** phase to apply Kubernetes manifests to your cluster\n");

        // Return ImageData for the last-built image (singular for backward compat).
        // Monorepo deploy/verify currently treats this as the primary image.
        const image: ImageData = {
            repository: `${config.acrLoginServer}/${lastImageName}`,
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
