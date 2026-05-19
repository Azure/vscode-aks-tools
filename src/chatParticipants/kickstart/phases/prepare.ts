import * as path from "path";
import * as vscode from "vscode";
import { generateDockerfileStep, DockerfileEnhancementInput } from "../steps/dockerfile";
import { generateManifestsStep, ExistingManifestInput } from "../steps/manifests";
import { AnalysisResult, ModuleAnalysis } from "../steps/analyze";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { failed } from "../../../commands/utils/errorable";
import { PhaseResult } from "../phaseRunner";
import { AnalysisData, ConfigData, ArtifactsData, StagedFile } from "../state";
import { StagedFileManager } from "../stagedFileManager";
import { reviewArtifacts, formatReviewFindings } from "../review";

/**
 * Generates Dockerfile and Kubernetes manifests with AKS Automatic awareness.
 *
 * This phase:
 * 1. Generates a Dockerfile optimized for the detected project
 * 2. Generates Kubernetes manifests (Deployment, Service, and optionally Ingress/HPA)
 * 3. Applies AKS Automatic-specific adaptations:
 *    - Omits resource requests/limits for Automatic clusters
 *    - Uses web app routing ingress class for Automatic
 *    - Skips HPA generation for Automatic
 * 4. Streams all artifacts to the user with save buttons
 * 5. Returns ArtifactsData with all generated files (not saved to disk yet)
 *
 * @param workspaceFolder The workspace folder URI
 * @param analysis Project analysis data from ANALYZE phase
 * @param config Cluster and registry configuration from CONFIGURE phase
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @param stagedFileManager Manages temp-dir staging of generated files
 * @param onFileStaged Called after each file is staged so the webview updates progressively
 * @returns PhaseResult with ArtifactsData on success
 */
export async function preparePhase(
    workspaceFolder: vscode.Uri,
    analysis: AnalysisData,
    config: ConfigData,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    stagedFileManager: StagedFileManager,
    onFileStaged: (file: StagedFile, allStaged: StagedFile[]) => void,
): Promise<PhaseResult & { artifacts?: ArtifactsData }> {
    try {
        const workspacePath = workspaceFolder.fsPath;

        stream.markdown("🐳 **Preparing artifacts**\n\n");

        // Show which cluster SKU is being used
        const skuLabel = config.clusterSku === "Automatic" ? "AKS Automatic" : "AKS Standard";
        stream.markdown(`Generating artifacts for **${skuLabel}** cluster...\n\n`);

        if (config.clusterSku === "Automatic") {
            stream.markdown(
                "ℹ️ **AKS Automatic adaptations:**\n" +
                    "- Resource limits will be omitted (Automatic manages these)\n" +
                    "- Web app routing ingress class will be used\n" +
                    "- Horizontal Pod Autoscaler will be skipped\n\n",
            );
        }

        const lmClient = new LMClient();
        const modelResult = await lmClient.ensureModel();
        if (failed(modelResult)) {
            return {
                ok: false,
                error: "GitHub Copilot language model is required for artifact generation. Please ensure Copilot is installed and signed in.",
                retryable: true,
            };
        }

        // Convert AnalysisData to AnalysisResult format for the step functions
        const analysisResult: AnalysisResult = {
            modules: analysis.modules,
            isMonorepo: analysis.isMonorepo,
        };

        // Read existing artifacts (if any), grouped per module, so each module gets enhanced
        // from its own existing files rather than mixed across modules.
        const existingDockerfileByModule = await readExistingDockerfilesByModule(analysis, workspacePath);
        const existingManifestsByModule = await readExistingManifestsByModule(analysis, workspacePath);

        const enhancedDockerfileSources: string[] = [];
        for (const input of existingDockerfileByModule.values()) {
            enhancedDockerfileSources.push(input.sourcePath ?? "Dockerfile");
        }
        const enhancedManifestSources: string[] = [];
        for (const list of existingManifestsByModule.values()) {
            for (const m of list) enhancedManifestSources.push(m.filename);
        }

        if (enhancedDockerfileSources.length > 0) {
            const list = enhancedDockerfileSources.map((s) => `\`${s}\``).join(", ");
            stream.markdown(
                `\n\uD83D\uDD04 **Enhancing ${enhancedDockerfileSources.length} existing Dockerfile(s)**: ${list} will be preserved and improved rather than replaced.\n\n`,
            );
        }
        if (enhancedManifestSources.length > 0) {
            const list = enhancedManifestSources.map((m) => `\`${m}\``).join(", ");
            stream.markdown(
                `\uD83D\uDD04 **Enhancing ${enhancedManifestSources.length} existing Kubernetes manifest(s)**: ${list} will be preserved and improved.\n\n`,
            );
        }

        // Step 1: Generate Dockerfile
        stream.markdown("**Generating Dockerfile...**\n\n");
        stream.progress("Generating Dockerfile...");

        const stagedSoFar: StagedFile[] = [];
        const dockerfileResult = await generateDockerfileStep(
            analysisResult,
            lmClient,
            stream,
            token,
            workspacePath,
            stagedFileManager,
            stagedSoFar,
            (file, allStaged) => {
                stagedSoFar.length = 0;
                stagedSoFar.push(...allStaged);
                onFileStaged(file, allStaged);
            },
            existingDockerfileByModule.size > 0 ? existingDockerfileByModule : undefined,
        );

        if (!dockerfileResult.succeeded) {
            return {
                ok: false,
                error: `Dockerfile generation failed: ${dockerfileResult.error}`,
                retryable: true,
            };
        }

        // Step 2: Generate Kubernetes manifests
        stream.markdown("**Generating Kubernetes manifests...**\n\n");
        stream.progress("Generating Kubernetes manifests...");

        const manifestsResult = await generateManifestsStep(
            analysisResult,
            dockerfileResult,
            lmClient,
            stream,
            token,
            workspacePath,
            stagedFileManager,
            stagedSoFar,
            (file, allStaged) => {
                stagedSoFar.length = 0;
                stagedSoFar.push(...allStaged);
                onFileStaged(file, allStaged);
            },
            {
                acrLoginServer: config.acrLoginServer,
                clusterName: config.clusterName,
                existingManifestsByModule: existingManifestsByModule.size > 0 ? existingManifestsByModule : undefined,
            },
        );

        if (!manifestsResult.succeeded) {
            return {
                ok: false,
                error: `Kubernetes manifest generation failed: ${manifestsResult.error}`,
                retryable: true,
            };
        }

        // Step 3: Apply AKS Automatic-specific content adaptations to already-staged manifests
        // Re-stage adapted versions so the temp files reflect the final content.
        const manifestFiles = manifestsResult.result.files;
        const adaptedStaged: StagedFile[] = [];

        for (const sf of stagedSoFar) {
            // Only process k8s manifests (not the Dockerfile)
            if (!isManifestFilename(sf.filename)) {
                adaptedStaged.push(sf);
                continue;
            }
            // Extract just the base filename for the AKS Automatic checks
            const baseFilename = manifestBaseFilename(sf.filename);
            const rawContent = manifestFiles[baseFilename] ?? sf.content;
            const processedContent =
                config.clusterSku === "Automatic" ? adaptManifestForAutomatic(rawContent, baseFilename) : rawContent;

            if (!processedContent.trim()) {
                // HPA/autoscaler filtered out — remove from staged set
                continue;
            }

            if (processedContent !== sf.content) {
                // Content changed — re-stage so the temp file is up to date
                const updated = await stagedFileManager.stage(sf.filename, processedContent);
                adaptedStaged.push(updated);
            } else {
                adaptedStaged.push(sf);
            }
        }

        // Step 4: Validate that we have required artifacts
        const hasDockerfile = adaptedStaged.some((s) => isDockerfileFilename(s.filename));
        const manifestStaged = adaptedStaged.filter((s) => isManifestFilename(s.filename));

        if (!hasDockerfile || manifestStaged.length === 0) {
            return {
                ok: false,
                error: "Failed to generate required artifacts (Dockerfile or Kubernetes manifests).",
                retryable: true,
            };
        }

        const hasDeployment = manifestStaged.some((m) => m.content.includes("kind: Deployment"));
        const hasService = manifestStaged.some((m) => m.content.includes("kind: Service"));

        if (!hasDeployment || !hasService) {
            return {
                ok: false,
                error: "Generated manifests must include at least Deployment and Service resources.",
                retryable: true,
            };
        }

        // Step 5: Review generated artifacts against safety guardrails
        stream.markdown("\n🔍 **Reviewing artifacts...**\n\n");
        const review = await reviewArtifacts(adaptedStaged);
        stream.markdown(`${formatReviewFindings(review)}\n\n`);

        if (!review.passed) {
            return {
                ok: false,
                error: "Generated artifacts failed safety review. See findings above.",
                retryable: true,
            };
        }

        // Step 6: Show generated files as a native file tree in chat
        const fileTree = buildNestedFileTree(adaptedStaged.map((s) => s.filename));

        stream.markdown("\n✅ **Files generated** — review in the panel, then click **Save to project**:\n\n");
        // Use the staging root as the filetree base so clicking a file opens the staged copy
        stream.filetree(fileTree, stagedFileManager.stagingRoot);

        // Reference chips — each stagedPath is a VS Code storage URI the user can open
        for (const sf of adaptedStaged) {
            stream.reference(vscode.Uri.parse(sf.stagedPath));
        }

        const artifacts: ArtifactsData = {
            stagedFiles: adaptedStaged,
            savedToDisk: false,
        };

        return { ok: true, artifacts };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Prepare phase failed: ${message}`,
            retryable: true,
        };
    }
}

/**
 * Adapts a Kubernetes manifest for AKS Automatic constraints.
 *
 * For Automatic clusters:
 * - Removes resource requests and limits from Pod specs
 * - Changes ingress class to 'webapprouting' (Azure's app routing)
 * - Skips HPA manifest generation
 *
 * @param content The YAML manifest content
 * @param filename The manifest filename (for detecting type)
 * @returns The adapted manifest content
 */
function adaptManifestForAutomatic(content: string, filename: string): string {
    // Skip HPA manifests entirely for Automatic
    if (filename.includes("hpa") || filename.includes("autoscaler")) {
        return ""; // Will be filtered out by caller
    }

    let adapted = content;

    // Remove resource requests and limits from containers
    adapted = adapted.replace(
        /^\s*resources:\s*\n\s*requests:\s*\n[\s\S]*?(?=\n\s*(?:name:|image:|ports:|env:|livenessProbe:|readinessProbe:|volumeMounts:|securityContext:|$))/gm,
        "",
    );

    adapted = adapted.replace(
        /^\s*limits:\s*\n[\s\S]*?(?=\n\s*(?:name:|image:|ports:|env:|livenessProbe:|readinessProbe:|volumeMounts:|securityContext:|$))/gm,
        "",
    );

    // Change ingress class to webapprouting for Automatic
    if (adapted.includes("kind: Ingress")) {
        // Replace existing ingressClassName if present
        adapted = adapted.replace(/^\s*ingressClassName:\s*.+$/m, "  ingressClassName: webapprouting");

        // If no ingressClassName was found, add it under metadata
        if (!adapted.includes("ingressClassName:")) {
            adapted = adapted.replace(
                /^(\s*metadata:[\s\S]*?name:.*\n)/m,
                (match) => `${match}  ingressClassName: webapprouting\n`,
            );
        }
    }

    // Remove empty resources sections that may be left over
    adapted = adapted.replace(/^\s*resources:\s*\n(?=\s*(?:name:|image:|ports:|env:|$))/gm, "");

    return adapted;
}

/**
 * Filename match helpers — staged filenames may be flat (single module / root)
 * or module-prefixed (monorepo): e.g. "Dockerfile", "src/api/Dockerfile",
 * "k8s/deployment.yaml", or "src/api/k8s/deployment.yaml".
 */
function isDockerfileFilename(filename: string): boolean {
    return filename === "Dockerfile" || filename.endsWith("/Dockerfile");
}

function isManifestFilename(filename: string): boolean {
    return /(^|\/)k8s\//.test(filename);
}

function manifestBaseFilename(filename: string): string {
    const idx = filename.lastIndexOf("k8s/");
    return idx >= 0 ? filename.substring(idx + "k8s/".length) : filename;
}

/**
 * Builds a nested ChatResponseFileTree from "/"-separated filenames.
 */
function buildNestedFileTree(filenames: string[]): vscode.ChatResponseFileTree[] {
    type Node = { name: string; children?: Node[] };
    const root: Node = { name: "", children: [] };
    for (const fn of filenames) {
        const parts = fn.split("/").filter((p) => p.length > 0);
        let curr: Node = root;
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i];
            const isLast = i === parts.length - 1;
            curr.children = curr.children ?? [];
            let next = curr.children.find((c) => c.name === name);
            if (!next) {
                next = isLast ? { name } : { name, children: [] };
                curr.children.push(next);
            }
            curr = next;
        }
    }
    return (root.children ?? []) as vscode.ChatResponseFileTree[];
}

/**
 * Returns the workspace-relative posix path of a module's source directory,
 * or "" for a root module. Mirrors `moduleStagePrefix` without the trailing slash.
 */
function moduleRelPosix(module: ModuleAnalysis, workspacePath: string): string {
    if (!module.modulePath) return "";
    const rel = path.isAbsolute(module.modulePath)
        ? path.relative(workspacePath, module.modulePath)
        : module.modulePath;
    if (!rel || rel === "." || rel.startsWith("..")) return "";
    return rel.split(path.sep).join("/");
}

/**
 * Picks the module whose source directory is the longest prefix of `relDir`.
 * Falls back to the first module if no prefix matches (defensive — keeps the
 * enhancement from being silently dropped when paths look unfamiliar).
 */
function pickModuleForRelDir(
    relDir: string,
    modules: ModuleAnalysis[],
    workspacePath: string,
): ModuleAnalysis | undefined {
    if (modules.length === 0) return undefined;
    const normRelDir = relDir.split(path.sep).join("/");
    let best: { module: ModuleAnalysis; len: number } | undefined;
    for (const mod of modules) {
        const modRel = moduleRelPosix(mod, workspacePath);
        if (modRel === "") {
            // Root module always matches; prefer more specific matches if any.
            if (!best) best = { module: mod, len: 0 };
            continue;
        }
        if (normRelDir === modRel || normRelDir.startsWith(`${modRel}/`)) {
            if (!best || modRel.length > best.len) {
                best = { module: mod, len: modRel.length };
            }
        }
    }
    return best?.module;
}

/**
 * Reads existing Dockerfiles and groups them per module so each module's
 * generation can be enhanced from its own existing file.
 */
async function readExistingDockerfilesByModule(
    analysis: AnalysisData,
    workspacePath: string,
): Promise<Map<string, DockerfileEnhancementInput>> {
    const result = new Map<string, DockerfileEnhancementInput>();
    const paths = analysis.existingDockerfilePaths ?? [];
    if (paths.length === 0) return result;
    for (const absPath of paths) {
        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
            const content = Buffer.from(bytes).toString("utf-8");
            if (!content.trim()) continue;
            const relPath = path.relative(workspacePath, absPath);
            const relDir = path.dirname(relPath);
            const module = pickModuleForRelDir(relDir, analysis.modules, workspacePath);
            if (!module) continue;
            const key = module.modulePath ?? "";
            if (result.has(key)) continue; // first match wins
            result.set(key, { content, sourcePath: relPath || "Dockerfile" });
        } catch {
            // Skip unreadable files silently
        }
    }
    return result;
}

/**
 * Reads existing K8s manifests and groups them per module so each module's
 * manifest generation only sees its own existing files.
 */
async function readExistingManifestsByModule(
    analysis: AnalysisData,
    workspacePath: string,
): Promise<Map<string, ExistingManifestInput[]>> {
    const result = new Map<string, ExistingManifestInput[]>();
    const paths = analysis.existingK8sManifestPaths ?? [];
    if (paths.length === 0) return result;
    for (const absPath of paths) {
        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
            const content = Buffer.from(bytes).toString("utf-8");
            if (!content.trim()) continue;
            const relPath = path.relative(workspacePath, absPath) || path.basename(absPath);
            const relDir = path.dirname(relPath);
            const module = pickModuleForRelDir(relDir, analysis.modules, workspacePath);
            if (!module) continue;
            const key = module.modulePath ?? "";
            const list = result.get(key) ?? [];
            list.push({ filename: relPath, content });
            result.set(key, list);
        } catch {
            // Skip unreadable files silently
        }
    }
    return result;
}
