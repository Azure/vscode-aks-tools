import * as vscode from "vscode";
import { analyzeProject as analyzeProjectStep, ModuleAnalysis } from "../steps/analyze";
import { checkExistingFiles } from "../../../commands/aksContainerAssist/fileOperations";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { PhaseResult } from "../phaseRunner";
import { AnalysisData } from "../state";

async function getDirectoryTree(workspacePath: string, maxDepth: number = 3): Promise<string> {
    const uri = vscode.Uri.file(workspacePath);
    const lines: string[] = [];

    async function walk(dir: vscode.Uri, prefix: string, depth: number) {
        if (depth > maxDepth) return;
        const entries = await vscode.workspace.fs.readDirectory(dir);
        const filtered = entries.filter(
            ([name]) => !name.startsWith(".") && name !== "node_modules" && name !== "__pycache__" && name !== "venv",
        );
        for (const [name, type] of filtered) {
            lines.push(`${prefix}${name}${type === vscode.FileType.Directory ? "/" : ""}`);
            if (type === vscode.FileType.Directory) {
                await walk(vscode.Uri.joinPath(dir, name), `${prefix}  `, depth + 1);
            }
        }
    }

    await walk(uri, "", 0);
    return lines.slice(0, 200).join("\n");
}

async function analyzeWithLM(
    workspacePath: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    model: vscode.LanguageModelChat,
): Promise<ModuleAnalysis[]> {
    stream.progress("Analyzing project structure...");

    const tree = await getDirectoryTree(workspacePath);

    const systemPrompt =
        "You are a project structure analyzer. Given a directory tree, identify deployable service modules. " +
        "Respond ONLY with valid JSON — no markdown, no explanation. " +
        'Return an array of objects with: name, modulePath (relative), language ("python"|"javascript"|"typescript"|"java"|"go"|"dotnet"|"rust"|"other"), ' +
        "framework (optional), entryPoint (optional, e.g. app.py, main.go), port (optional number).";

    const userPrompt =
        `Analyze this directory tree and identify all deployable service modules:\n\n${tree}\n\n` +
        "Look for: package.json, requirements.txt, go.mod, pom.xml, Cargo.toml, *.csproj, Dockerfile, or any main entry point files. " +
        "Each directory with its own dependency file is a separate module.";

    const messages = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
        vscode.LanguageModelChatMessage.User(userPrompt),
    ];

    const chatResponse = await model.sendRequest(messages, {}, token);

    let responseText = "";
    for await (const fragment of chatResponse.text) {
        responseText += fragment;
    }

    try {
        const text = responseText
            .replace(/```json?\s*/g, "")
            .replace(/```\s*/g, "")
            .trim();
        const parsed = JSON.parse(text);
        const modules: ModuleAnalysis[] = (Array.isArray(parsed) ? parsed : [parsed]).map(
            (m: Record<string, unknown>) => ({
                name: String(m.name ?? ""),
                modulePath: String(m.modulePath ?? ""),
                language: String(m.language ?? "other"),
                framework: m.framework ? String(m.framework) : undefined,
                entryPoint: m.entryPoint ? String(m.entryPoint) : undefined,
                port: typeof m.port === "number" ? m.port : undefined,
            }),
        );
        return modules.filter((m) => m.name && m.language);
    } catch {
        return [];
    }
}

export async function analyzePhase(
    workspaceFolder: vscode.Uri,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    request: vscode.ChatRequest,
): Promise<PhaseResult & { analysis?: AnalysisData }> {
    try {
        const workspacePath = workspaceFolder.fsPath;
        const chatModel = request.model;

        stream.markdown("📊 **Analyzing project structure**\n\n");
        stream.progress("Scanning project files...");

        const lmClient = new LMClient();
        const analysisResult = await analyzeProjectStep(workspacePath, lmClient, token);

        let modules: ModuleAnalysis[];
        let isMonorepo: boolean;

        if (analysisResult.succeeded && analysisResult.result.modules.length > 0) {
            modules = analysisResult.result.modules;
            isMonorepo = analysisResult.result.isMonorepo;
        } else {
            modules = await analyzeWithLM(workspacePath, stream, token, chatModel);
            isMonorepo = modules.length > 1;

            if (modules.length === 0) {
                return {
                    ok: false,
                    error:
                        "Could not detect any project modules. Please ensure the repository contains " +
                        "recognizable project files (package.json, requirements.txt, go.mod, pom.xml, etc.).",
                    retryable: true,
                };
            }
        }

        const existingFiles = await checkExistingFiles(workspacePath);
        const primaryModule = modules[0];

        if (!primaryModule?.language) {
            return {
                ok: false,
                error: "Could not detect project language. Please ensure your project has recognizable code files.",
                retryable: false,
            };
        }

        stream.markdown("### Project Analysis Results\n\n");

        let summaryTable = "| Property | Value |\n";
        summaryTable += "|----------|-------|\n";
        summaryTable += `| **Language** | ${primaryModule.language} |\n`;
        if (primaryModule.framework) {
            summaryTable += `| **Framework** | ${primaryModule.framework} |\n`;
        }
        if (primaryModule.entryPoint) {
            summaryTable += `| **Entry Point** | ${primaryModule.entryPoint} |\n`;
        }
        if (primaryModule.port) {
            summaryTable += `| **Port** | ${primaryModule.port} |\n`;
        }
        summaryTable += `| **Modules** | ${modules.length} |\n`;
        summaryTable += `| **Monorepo** | ${isMonorepo ? "Yes" : "No"} |\n`;

        stream.markdown(summaryTable);

        if (existingFiles.hasDockerfile || existingFiles.hasK8sManifests) {
            stream.markdown("\n### Existing Artifacts Detected\n\n");

            if (existingFiles.hasDockerfile && existingFiles.dockerfilePaths) {
                if (existingFiles.dockerfilePaths.length === 1) {
                    stream.markdown(`- **Dockerfile**: \`${existingFiles.dockerfilePaths[0]}\`\n`);
                } else {
                    stream.markdown(`- **Dockerfiles** (${existingFiles.dockerfilePaths.length}):\n`);
                    for (const dfPath of existingFiles.dockerfilePaths) {
                        stream.markdown(`  - \`${dfPath}\`\n`);
                    }
                }
            }

            if (existingFiles.hasK8sManifests && existingFiles.k8sManifestPaths) {
                stream.markdown("- **Kubernetes Manifests**:\n");
                for (const manifestPath of existingFiles.k8sManifestPaths) {
                    stream.markdown(`  - \`${manifestPath}\`\n`);
                }
            }
        }

        if (isMonorepo && modules.length > 1) {
            stream.markdown("\n### Detected Modules\n\n");
            for (const mod of modules) {
                stream.markdown(
                    `- **${mod.name}** (${mod.language}${mod.framework ? ` / ${mod.framework}` : ""}) — \`${mod.modulePath}\`\n`,
                );
            }
            stream.markdown("\nAll modules will be containerized. You can re-run analyze to change this.\n");
        }

        if (primaryModule.port) {
            stream.markdown(`\nExposing port **${primaryModule.port}** (detected from project).\n`);
        }

        const analysis: AnalysisData = {
            language: primaryModule.language,
            framework: primaryModule.framework,
            ports: primaryModule.port ? [primaryModule.port] : [],
            entryPoint: primaryModule.entryPoint,
            isMonorepo,
            modules: modules,
            hasDockerfile: existingFiles.hasDockerfile,
            hasK8sManifests: existingFiles.hasK8sManifests,
            hasGitHubWorkflow: false,
            existingDockerfilePaths: existingFiles.dockerfilePaths,
            existingK8sManifestPaths: existingFiles.k8sManifestPaths,
        };

        return {
            ok: true,
            analysis,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Analysis phase failed: ${message}`,
            retryable: true,
        };
    }
}
