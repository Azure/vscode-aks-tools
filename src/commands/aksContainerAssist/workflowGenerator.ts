/**
 * GitHub Workflow Generator for AKS deployments
 * This module handles the generation of GitHub Actions workflows for building and deploying to AKS
 * Independent of Container Assist SDK
 */

import * as vscode from "vscode";
import * as path from "path";
import * as l10n from "@vscode/l10n";
import { Errorable } from "../utils/errorable";
import {
    WorkflowConfig,
    renderWorkflowTemplate,
    validateWorkflowConfig,
    ContainerMode,
    ContainerJobConfig,
    MultiContainerWorkflowConfig,
    renderMultiContainerWorkflowTemplate,
    validateMultiContainerWorkflowConfig,
    sanitizeJobId,
} from "./workflowTemplate";
import {
    writeWorkflowFile,
    workflowFileExists,
    fileExists,
    scanForK8sManifests,
    scanForDockerfiles,
    scanManifestsForModulePaths,
    getK8sManifestFolder,
} from "./fileOperations";
import { logger } from "./logger";
import type { AzureContext } from "./azureSelections";
import { ContainerAssistService } from "./containerAssistService";
import type { ModuleAnalysisResult } from "./types";

/** Parameters for workflow generation, replacing positional arguments. */
export interface WorkflowGenerationOptions {
    workspaceFolder: vscode.WorkspaceFolder;
    projectRoot: string;
    azureContext: AzureContext;
    hasBothActions: boolean;
    /** Output from deployment generation, used to skip prompts and reuse known paths. */
    deploymentResult?: { manifestPaths?: string[]; primaryModuleName?: string };
}

/** Normalize a relative path to POSIX separators so GitHub Actions (Linux) can use it. */
function toPosixPath(p: string): string {
    return p.replace(/\\/g, "/");
}

export function generateGitHubWorkflow(options: WorkflowGenerationOptions): Promise<Errorable<string>> {
    return Promise.resolve(
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t("Generating GitHub workflow file..."),
                cancellable: false,
            },
            () => doGenerateGitHubWorkflow(options),
        ),
    );
}

async function doGenerateGitHubWorkflow(options: WorkflowGenerationOptions): Promise<Errorable<string>> {
    const { workspaceFolder, projectRoot, azureContext, hasBothActions, deploymentResult } = options;
    try {
        const workspaceRoot = workspaceFolder.uri.fsPath;
        const collected = await collectWorkflowConfiguration(
            workspaceRoot,
            projectRoot,
            azureContext,
            hasBothActions,
            deploymentResult?.manifestPaths,
            deploymentResult?.primaryModuleName,
        );
        if (!collected) {
            return { succeeded: false, error: "cancelled" };
        }

        // Validate configuration based on mode
        const validationErrors =
            collected.mode === ContainerMode.Multi
                ? validateMultiContainerWorkflowConfig(collected.config)
                : validateWorkflowConfig(collected.config);
        if (validationErrors.length > 0) {
            const errorMsg = validationErrors.join("; ");
            logger.error("Workflow configuration validation failed", errorMsg);
            return { succeeded: false, error: `Invalid configuration: ${errorMsg}` };
        }

        const workflowName = sanitizeWorkflowName(collected.config.workflowName);
        const exists = await workflowFileExists(workspaceRoot, workflowName);
        if (exists) {
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Workflow file "{0}.yml" already exists. Overwrite?', workflowName),
                l10n.t("Overwrite"),
                l10n.t("Cancel"),
            );
            if (overwrite !== l10n.t("Overwrite")) {
                return { succeeded: false, error: "cancelled" };
            }
        }

        // Render template and write file
        const workflowContent =
            collected.mode === ContainerMode.Multi
                ? renderMultiContainerWorkflowTemplate(collected.config)
                : renderWorkflowTemplate(collected.config);

        const workflowPath = await writeWorkflowFile(workspaceRoot, workflowName, workflowContent);

        vscode.window.showInformationMessage(
            l10n.t("GitHub workflow written to: {0}", path.relative(workspaceRoot, workflowPath) || workflowPath),
        );

        return { succeeded: true, result: workflowPath };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to generate workflow", error);
        return { succeeded: false, error: `Failed to generate workflow: ${errorMsg}` };
    }
}

/** Tagged result returned by `collectWorkflowConfiguration`. */
type CollectedWorkflowConfig =
    | { mode: ContainerMode.Single; config: WorkflowConfig }
    | { mode: ContainerMode.Multi; config: MultiContainerWorkflowConfig };

async function collectWorkflowConfiguration(
    workspaceRoot: string,
    projectRoot: string,
    azureContext: AzureContext,
    hasBothActions: boolean,
    knownManifestPaths?: string[],
    primaryModuleName?: string,
): Promise<CollectedWorkflowConfig | undefined> {
    const {
        clusterName,
        clusterResourceGroup,
        acrName,
        acrResourceGroup,
        namespace,
        isManagedNamespace,
        workflowName,
    } = azureContext;
    if (!clusterName || !clusterResourceGroup || !namespace || !workflowName) {
        logger.error("collectWorkflowConfiguration called with incomplete Azure context");
        return undefined;
    }

    // Search recursively; prefer the shallowest match for auto-selection.
    const detectedDockerfiles = await detectDockerfilePaths(projectRoot);

    // Container mode prompt — only when >= 2 Dockerfiles detected (Issue #2105).
    // When `hasBothActions` is true (deployment was just generated in the same flow),
    // we always honor the user's earlier selections without re-prompting in single mode.
    let mode: ContainerMode = ContainerMode.Single;
    if (detectedDockerfiles.length >= 2) {
        const chosen = await promptForContainerMode(detectedDockerfiles.length);
        if (!chosen) return undefined;
        mode = chosen;
    }

    if (mode === ContainerMode.Multi) {
        const multi = await collectMultiContainerWorkflowConfiguration(
            workspaceRoot,
            projectRoot,
            azureContext,
            detectedDockerfiles,
        );
        if (!multi) return undefined;
        return { mode: ContainerMode.Multi, config: multi };
    }

    // ---- Existing single-container flow ----
    const appName = primaryModuleName ?? path.basename(projectRoot);
    const detectedDockerfile = detectedDockerfiles.length > 0 ? detectedDockerfiles[0] : undefined;

    let dockerfilePath: string | undefined;
    if (hasBothActions && detectedDockerfile) {
        dockerfilePath = detectedDockerfile;
    } else {
        dockerfilePath = await promptForDockerfilePath(projectRoot, detectedDockerfiles);
    }
    if (!dockerfilePath) return undefined;

    // Build context: use the Dockerfile's directory when in a subdirectory, else ".".
    // Auto-derive when both actions were selected; otherwise prompt.
    let buildContextPath: string | undefined;
    const dockerfileDir = path.dirname(dockerfilePath);
    const defaultBuildContext = dockerfileDir !== "." ? dockerfileDir : ".";
    if (hasBothActions) {
        buildContextPath = defaultBuildContext;
    } else {
        buildContextPath = await promptForBuildContext(defaultBuildContext, dockerfilePath, projectRoot);
    }
    if (!buildContextPath) return undefined;

    // Use known manifest paths from deployment (absolute) instead of re-scanning,
    // so manifests in module subdirectories are always found.
    let relativeManifests: string[];
    if (hasBothActions && knownManifestPaths && knownManifestPaths.length > 0) {
        relativeManifests = knownManifestPaths.map((p) => toPosixPath(path.relative(workspaceRoot, p)));
    } else {
        const detection = await detectK8sManifests(workspaceRoot, projectRoot);
        if (!detection.succeeded) {
            logger.error("Manifest detection failed", detection.error);
            void vscode.window.showErrorMessage(l10n.t("Failed to detect Kubernetes manifests: {0}", detection.error));
            return undefined;
        }
        relativeManifests = detection.result.map((p) => toPosixPath(path.relative(workspaceRoot, p)));
    }

    // Resolve build context to an absolute path, then make it workspace-relative for the YAML.
    const dockerfileAbsolute = path.resolve(projectRoot, dockerfilePath);
    const buildContextAbsolute = buildContextPath === "." ? projectRoot : path.resolve(projectRoot, buildContextPath);
    const buildContextRelToWorkspace = toPosixPath(path.relative(workspaceRoot, buildContextAbsolute)) || ".";

    // DOCKER_FILE in `az acr build -f` is relative to the build context, not the repo root.
    const dockerfileRelToBuildContext = toPosixPath(path.relative(buildContextAbsolute, dockerfileAbsolute));

    let selectedManifests: string[] | undefined;
    if (hasBothActions && relativeManifests.length > 0) {
        selectedManifests = relativeManifests;
    } else {
        selectedManifests = await promptForManifestSelection(relativeManifests, workspaceRoot, appName);
    }
    if (!selectedManifests) return undefined;
    const manifestPath = formatManifestPathForYamlBlock(selectedManifests);

    return {
        mode: ContainerMode.Single,
        config: {
            workflowName,
            branchName: "main", // Default to main
            containerName: appName, // Use app name as container name
            dockerFile: dockerfileRelToBuildContext,
            buildContextPath: buildContextRelToWorkspace,
            acrResourceGroup,
            azureContainerRegistry: acrName,
            clusterName,
            clusterResourceGroup,
            deploymentManifestPath: manifestPath,
            namespace,
            isManagedNamespace: isManagedNamespace ?? false,
        },
    };
}

/**
 * Multi-container collection flow (Issue #2106, #2107, #2108).
 * Lets the user multi-select Dockerfiles, auto-derives per-service config, and
 * prompts (Browse / Enter manually / Skip) only when manifests are missing.
 */
async function collectMultiContainerWorkflowConfiguration(
    workspaceRoot: string,
    projectRoot: string,
    azureContext: AzureContext,
    detectedDockerfiles: string[],
): Promise<MultiContainerWorkflowConfig | undefined> {
    const {
        clusterName,
        clusterResourceGroup,
        acrName,
        acrResourceGroup,
        namespace,
        isManagedNamespace,
        workflowName,
    } = azureContext;

    // Best-effort module analysis to enrich the multi-select with language/framework/port.
    const service = new ContainerAssistService();
    const analysis = await service.analyzeRepository(projectRoot);
    const modules: ModuleAnalysisResult[] = analysis.succeeded ? analysis.result.modules : [];

    const selected = await promptForMultiDockerfileSelection(detectedDockerfiles, modules, projectRoot);
    if (!selected || selected.length === 0) return undefined;

    // Map module path -> manifests, scanned in parallel for all selected services.
    const moduleScanRoots = selected.map((s) => path.dirname(path.resolve(projectRoot, s.dockerfileRelToProject)));
    const manifestsByModule = await scanManifestsForModulePaths(moduleScanRoots);

    const containers: ContainerJobConfig[] = [];
    /** Track the first manually-chosen manifest to offer "apply to all" shortcut (#2163). */
    let sharedManifestPath: string | undefined;
    let applySharedToAll = false;

    for (let idx = 0; idx < selected.length; idx++) {
        const item = selected[idx];
        const dockerfileAbsolute = path.resolve(projectRoot, item.dockerfileRelToProject);
        const buildContextAbsolute = path.dirname(dockerfileAbsolute);
        const buildContextRelToWorkspace = toPosixPath(path.relative(workspaceRoot, buildContextAbsolute)) || ".";
        const dockerfileRelToBuildContext = toPosixPath(path.relative(buildContextAbsolute, dockerfileAbsolute));

        const moduleManifests = manifestsByModule.get(buildContextAbsolute) ?? [];
        let manifestPath: string | undefined;

        if (applySharedToAll && sharedManifestPath) {
            // User chose "Apply to all remaining" — reuse the shared manifest.
            manifestPath = sharedManifestPath;
        } else if (moduleManifests.length > 0) {
            const relManifests = moduleManifests.map((p) => toPosixPath(path.relative(workspaceRoot, p)));
            manifestPath = formatManifestPathForYamlBlock(relManifests);
        } else {
            // No manifests under <module>/k8s — offer Browse / Manual / Skip.
            const chosen = await promptForManifestWithBrowse(item.containerName, workspaceRoot);
            if (chosen === undefined) return undefined; // user cancelled
            if (chosen.length === 0) {
                manifestPath = undefined; // user picked Skip — build-only for this service
            } else {
                manifestPath = formatManifestPathForYamlBlock(chosen);
            }
        }

        // After the first service manifest is resolved, offer to apply it to
        // all remaining services that also lack auto-detected manifests (#2163).
        if (idx === 0 && manifestPath && !applySharedToAll && selected.length > 1) {
            const remainingWithoutManifests = selected.slice(1).filter((s) => {
                const dir = path.dirname(path.resolve(projectRoot, s.dockerfileRelToProject));
                return (manifestsByModule.get(dir) ?? []).length === 0;
            });
            if (remainingWithoutManifests.length > 0) {
                const apply = l10n.t("Apply to all remaining services");
                const individual = l10n.t("Choose individually");
                const choice = await vscode.window.showQuickPick(
                    [
                        { label: apply, description: l10n.t("Use this manifest for all services") },
                        { label: individual, description: l10n.t("Pick a different manifest per service") },
                    ],
                    {
                        placeHolder: l10n.t("Apply the same manifest to remaining services?"),
                        title: l10n.t("Shared Manifest"),
                        ignoreFocusOut: true,
                    },
                );
                if (!choice) return undefined;
                if (choice.label === apply) {
                    sharedManifestPath = manifestPath;
                    applySharedToAll = true;
                }
            }
        }

        containers.push({
            containerName: item.containerName,
            dockerFile: dockerfileRelToBuildContext,
            buildContextPath: buildContextRelToWorkspace,
            deploymentManifestPath: manifestPath,
        });
    }

    return {
        workflowName: workflowName!,
        branchName: "main",
        acrResourceGroup,
        azureContainerRegistry: acrName,
        clusterName: clusterName!,
        clusterResourceGroup: clusterResourceGroup!,
        namespace: namespace!,
        isManagedNamespace: isManagedNamespace ?? false,
        containers,
    };
}

/**
 * Searches for Dockerfiles within the project directory (up to 3 levels deep).
 * Returns paths relative to projectRoot, shallowest first.
 * Returns an empty array if none are found.
 */
async function detectDockerfilePaths(projectRoot: string): Promise<string[]> {
    const absolutePaths = await scanForDockerfiles(projectRoot);
    return absolutePaths.map((p) => path.relative(projectRoot, p));
}

/**
 * Prompts user to select or confirm a Dockerfile path.
 * Shows a QuickPick when multiple Dockerfiles are detected; falls back to an
 * input box when none are found (so the user can type a custom path).
 */
async function promptForDockerfilePath(projectRoot: string, detectedPaths: string[]): Promise<string | undefined> {
    if (detectedPaths.length === 1) {
        // Single Dockerfile — present as pre-filled input box with validation
        const result = await vscode.window.showInputBox({
            prompt: l10n.t("Enter Dockerfile path (relative to project root)\n✓ Found: {0}", detectedPaths[0]),
            placeHolder: "Dockerfile",
            value: detectedPaths[0],
            title: l10n.t("Dockerfile Location"),
            ignoreFocusOut: true,
            validateInput: async (value) => {
                if (!value || value.trim() === "") {
                    return l10n.t("Dockerfile path is required");
                }
                if (value.startsWith("/") || value.includes("..")) {
                    return l10n.t("Dockerfile path must be a relative path within the project");
                }
                const fullPath = path.join(projectRoot, value);
                if (!(await fileExists(fullPath))) {
                    return l10n.t("Dockerfile not found at this path");
                }
                return undefined;
            },
        });
        return result?.trim();
    }

    if (detectedPaths.length > 1) {
        // Multiple Dockerfiles — let user pick from a QuickPick list
        const items: vscode.QuickPickItem[] = detectedPaths.map((p) => ({
            label: p,
            description: p === "Dockerfile" ? l10n.t("(repo root)") : undefined,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: l10n.t("Multiple Dockerfiles found — select one to use"),
            title: l10n.t("Dockerfile Location ({0} found)", detectedPaths.length),
            ignoreFocusOut: true,
        });
        return selected?.label;
    }

    // No Dockerfile found — free-text input box
    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter Dockerfile path (relative to project root)\nNot found - using default"),
        placeHolder: "Dockerfile",
        value: "Dockerfile",
        title: l10n.t("Dockerfile Location"),
        ignoreFocusOut: true,
        validateInput: async (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Dockerfile path is required");
            }
            if (value.startsWith("/") || value.includes("..")) {
                return l10n.t("Dockerfile path must be a relative path within the project");
            }
            const fullPath = path.join(projectRoot, value);
            if (!(await fileExists(fullPath))) {
                return l10n.t("Dockerfile not found at this path");
            }
            return undefined;
        },
    });
    return result?.trim();
}

/**
 * Prompts user to enter build context path
 */
async function promptForBuildContext(
    defaultContext: string,
    dockerfilePath: string,
    projectRoot: string,
): Promise<string | undefined> {
    const dockerfileAbsolute = path.resolve(projectRoot, dockerfilePath);
    const result = await vscode.window.showInputBox({
        prompt: l10n.t("Enter build context path (directory containing source code)"),
        placeHolder: ".",
        value: defaultContext,
        title: l10n.t("Build Context"),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Build context path is required");
            }
            // Validate it's a valid relative path
            if (value.startsWith("/") || value.includes("..")) {
                return l10n.t("Build context must be a relative path within the project");
            }
            // `az acr build -f` requires the Dockerfile to be within the build context.
            const contextAbsolute = value === "." ? projectRoot : path.resolve(projectRoot, value);
            if (toPosixPath(path.relative(contextAbsolute, dockerfileAbsolute)).startsWith("..")) {
                return l10n.t("Build context must contain the Dockerfile");
            }
            return undefined;
        },
    });

    return result?.trim();
}

/**
 * Prompts user to select Kubernetes manifest files from a multi-select dropdown.
 * Detected manifests are pre-selected. When none are detected, falls back to the
 * Browse / Enter manually / Skip dialog (Issue #2108) so users no longer have to
 * copy-paste a path into a plain InputBox.
 */
async function promptForManifestSelection(
    detectedPaths: string[],
    workspaceRoot: string,
    serviceName: string,
): Promise<string[] | undefined> {
    if (detectedPaths.length === 0) {
        // Single-container mode requires at least one manifest, so don't offer
        // Skip here — it would be misleading (we'd just warn and cancel).
        const chosen = await promptForManifestWithBrowse(serviceName, workspaceRoot, { allowSkip: false });
        if (chosen === undefined) return undefined;
        if (chosen.length === 0) {
            // Defensive: with allowSkip=false the dialog never returns [], but
            // keep the warning as a safety net in case the user dismissed an
            // empty Browse selection.
            await vscode.window.showWarningMessage(
                l10n.t("At least one Kubernetes manifest path is required for the deploy job."),
            );
            return undefined;
        }
        return chosen;
    }

    const items: vscode.QuickPickItem[] = detectedPaths.map((p) => ({
        label: p,
        picked: true,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: l10n.t("Select Kubernetes manifests to include in the workflow"),
        title: l10n.t("Kubernetes Manifests ({0} detected)", detectedPaths.length),
        ignoreFocusOut: true,
    });

    if (!selected || selected.length === 0) return undefined;
    return selected.map((item) => item.label);
}

/** Item returned by the multi-Dockerfile picker. */
interface SelectedDockerfile {
    /** Dockerfile path relative to projectRoot. */
    dockerfileRelToProject: string;
    /** Derived service / container name (module name when available, else parent dir). */
    containerName: string;
}

/**
 * Prompts the user to choose between Single- and Multi-container mode.
 * Issue #2105 — only invoked when >= 2 Dockerfiles are detected.
 */
async function promptForContainerMode(dockerfileCount: number): Promise<ContainerMode | undefined> {
    interface ModeItem extends vscode.QuickPickItem {
        mode: ContainerMode;
    }
    const items: ModeItem[] = [
        {
            label: l10n.t("$(package) Single Container"),
            description: l10n.t("Build & deploy one container image"),
            mode: ContainerMode.Single,
        },
        {
            label: l10n.t("$(symbol-namespace) Multi-Container (mono repo)"),
            description: l10n.t("Build & deploy multiple container images in one workflow"),
            mode: ContainerMode.Multi,
        },
    ];
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: l10n.t("Multiple Dockerfiles found ({0}). Choose container mode.", dockerfileCount),
        title: l10n.t("Container Mode"),
        ignoreFocusOut: true,
    });
    return picked?.mode;
}

/**
 * Prompts the user to multi-select which Dockerfiles to include (Issue #2106).
 * All detected Dockerfiles are pre-checked. Description is enriched from
 * module analysis (language / framework / port) when available.
 *
 * Returns `undefined` on cancel and re-prompts once if the user unchecks
 * everything (Issue #2112 — empty selection edge case).
 */
async function promptForMultiDockerfileSelection(
    detectedPaths: string[],
    modules: ModuleAnalysisResult[],
    projectRoot: string,
): Promise<SelectedDockerfile[] | undefined> {
    interface DockerfileItem extends vscode.QuickPickItem {
        dockerfileRelToProject: string;
        containerName: string;
    }

    // Build a map of absolute module dir -> module for enrichment.
    const moduleByDir = new Map<string, ModuleAnalysisResult>();
    for (const m of modules) {
        moduleByDir.set(path.resolve(m.modulePath), m);
    }

    const items: DockerfileItem[] = detectedPaths.map((rel) => {
        const dockerfileAbsolute = path.resolve(projectRoot, rel);
        const moduleDir = path.dirname(dockerfileAbsolute);
        const module = moduleByDir.get(moduleDir);
        const containerName = module?.name ?? path.basename(moduleDir) ?? "container";
        const descParts: string[] = [];
        if (module?.language) descParts.push(module.language);
        if (module?.framework) descParts.push(module.framework);
        if (module?.port) descParts.push(`port ${module.port}`);
        return {
            label: rel,
            description: descParts.length > 0 ? `(${descParts.join(", ")})` : undefined,
            detail: l10n.t("Container: {0}", containerName),
            picked: true,
            dockerfileRelToProject: rel,
            containerName,
        };
    });

    // First attempt
    let selection = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: l10n.t("Select Dockerfiles to include ({0} found)", detectedPaths.length),
        title: l10n.t("Multi-Container — Select Dockerfiles"),
        ignoreFocusOut: true,
    });

    // Edge case: user unchecked everything. Inform and re-prompt once. Await
    // the warning so the user sees why their first selection was rejected
    // before the retry picker is shown.
    if (selection && selection.length === 0) {
        await vscode.window.showWarningMessage(
            l10n.t("Select at least one Dockerfile to continue with the multi-container workflow."),
        );
        selection = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: l10n.t("Select at least one Dockerfile"),
            title: l10n.t("Multi-Container — Select Dockerfiles"),
            ignoreFocusOut: true,
        });
    }

    if (!selection || selection.length === 0) return undefined;

    // De-duplicate generated container names. We track collisions by sanitized
    // job id so that names that look distinct (e.g. "api@v1" and "api#v1") but
    // collapse to the same job id ("api-v1") get differentiated here rather
    // than failing validation later.
    const usedJobIds = new Set<string>();
    return selection.map((item) => {
        let name = item.containerName;
        let suffix = 2;
        while (usedJobIds.has(sanitizeJobId(name))) {
            name = `${item.containerName}-${suffix++}`;
        }
        usedJobIds.add(sanitizeJobId(name));
        return { dockerfileRelToProject: item.dockerfileRelToProject, containerName: name };
    });
}

/**
 * Browse / Enter manually / Skip dialog for missing K8s manifests (Issue #2108).
 *
 * Return value semantics:
 *   - `undefined`  → user cancelled the dialog (treat as cancel of the whole flow).
 *   - `[]`         → user chose "Skip" (caller decides whether to omit or treat as cancel).
 *   - `string[]`   → workspace-relative POSIX paths to the chosen manifest files.
 *
 * `allowSkip` (default `true`) controls whether the "Skip" choice is offered;
 * single-container callers pass `false` because a deploy job without manifests
 * is meaningless in that mode.
 */
async function promptForManifestWithBrowse(
    serviceName: string,
    workspaceRoot: string,
    options?: { allowSkip?: boolean },
): Promise<string[] | undefined> {
    const allowSkip = options?.allowSkip ?? true;
    const browse = l10n.t("Browse...");
    const manual = l10n.t("Enter path manually");
    const skip = l10n.t("Skip");

    const choices = allowSkip ? [browse, manual, skip] : [browse, manual];
    const choice = await vscode.window.showInformationMessage(
        l10n.t('No K8s manifests found for "{0}". How would you like to specify them?', serviceName),
        { modal: false },
        ...choices,
    );

    if (!choice) return undefined; // dismissed
    if (choice === skip) return [];

    if (choice === browse) {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(workspaceRoot),
            filters: { [l10n.t("Kubernetes Manifests")]: ["yaml", "yml"] },
            title: l10n.t('Select K8s manifests for "{0}"', serviceName),
            openLabel: l10n.t("Select"),
        });
        if (!uris || uris.length === 0) return undefined;
        // Reject anything outside the workspace — path.relative produces
        // "../..." entries that the manual-path validator forbids and that
        // won't exist in the checked-out repo at workflow run time.
        const wsRootAbs = path.resolve(workspaceRoot);
        const inWorkspace: string[] = [];
        const outsideWorkspace: string[] = [];
        for (const u of uris) {
            const rel = path.relative(wsRootAbs, u.fsPath);
            if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
                outsideWorkspace.push(u.fsPath);
            } else {
                inWorkspace.push(toPosixPath(rel));
            }
        }
        if (outsideWorkspace.length > 0) {
            await vscode.window.showWarningMessage(
                l10n.t(
                    "Some selected manifest files are outside the workspace and were ignored: {0}",
                    outsideWorkspace.join(", "),
                ),
            );
        }
        if (inWorkspace.length === 0) return undefined;
        return inWorkspace;
    }

    // Manual path entry
    const typed = await vscode.window.showInputBox({
        prompt: l10n.t('Enter K8s manifest path for "{0}" (relative to repo root)', serviceName),
        placeHolder: "k8s/deployment.yaml",
        value: "k8s/deployment.yaml",
        title: l10n.t("Kubernetes Manifests — {0}", serviceName),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim() === "") return l10n.t("A manifest path is required");
            if (value.startsWith("/") || value.includes("..")) {
                return l10n.t("Manifest path must be a relative path within the repository");
            }
            return undefined;
        },
    });
    if (!typed) return undefined;
    return [toPosixPath(typed.trim())];
}

function formatManifestPathForYamlBlock(manifests: string[]): string {
    if (manifests.length === 1) {
        return manifests[0];
    }
    return `|\n${manifests.map((manifest) => `        ${manifest}`).join("\n")}`;
}

/**
 * Detects Kubernetes manifests by scanning each module's <modulePath>/<k8sFolder>
 * (via analyzeRepository), matching where deployment generation writes them.
 * When no modules are detected, scans the workspace root as the legitimate
 * non-monorepo path. Repository analysis failures propagate (fail fast) so the
 * caller can surface the real error instead of silently degrading.
 */
async function detectK8sManifests(workspaceRoot: string, projectRoot: string): Promise<Errorable<string[]>> {
    const service = new ContainerAssistService();
    const analysis = await service.analyzeRepository(projectRoot);
    if (!analysis.succeeded) {
        return { succeeded: false, error: `Repository analysis failed: ${analysis.error}` };
    }

    if (analysis.result.modules.length === 0) {
        const hits = await scanForK8sManifests(workspaceRoot);
        return { succeeded: true, result: hits };
    }

    const manifestFolder = getK8sManifestFolder();
    const scanRoots = Array.from(new Set(analysis.result.modules.map((m) => path.join(m.modulePath, manifestFolder))));
    const results = await Promise.all(scanRoots.map((root) => scanForK8sManifests(root)));
    return { succeeded: true, result: Array.from(new Set(results.flat())) };
}

/**
 * Sanitizes workflow name to be used as filename
 */
function sanitizeWorkflowName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
}
