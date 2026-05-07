import * as vscode from "vscode";
import { ModuleAnalysis } from "./steps/analyze";

/**
 * Phase enum representing the stages of the kickstart workflow.
 *
 * Phases execute sequentially, each building on data from prior phases:
 * - ANALYZE (0): Project inspection - detects language, framework, ports
 * - CONFIGURE (1): Azure resource selection - cluster, registry, pre-flight checks
 * - PREPARE (2): Artifact generation - Dockerfile and Kubernetes manifests
 * - BUILD (3): Container image build and push to ACR
 * - DEPLOY (4): Apply manifests to AKS cluster via kubectl
 * - VERIFY (5): Check pod health and retrieve service endpoint
 * - COMPLETE (6): Final state after successful verification
 */
export enum Phase {
    ANALYZE = 0,
    CONFIGURE = 1,
    PREPARE = 2,
    BUILD = 3,
    DEPLOY = 4,
    VERIFY = 5,
    COMPLETE = 6,
}

/**
 * Analysis data from project inspection
 */
export interface AnalysisData {
    language: string;
    framework?: string;
    ports: number[];
    entryPoint?: string;
    isMonorepo: boolean;
    modules: ModuleAnalysis[];
    hasDockerfile: boolean;
    hasK8sManifests: boolean;
    hasGitHubWorkflow: boolean;
}

/**
 * Configuration data for cluster and registry
 */
export interface ConfigData {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
    clusterSku: "Automatic" | "Standard";
    acrName: string;
    acrLoginServer: string;
    canGetKubeconfig: boolean;
    hasAcrPull: boolean;
}

/**
 * Status of a single staged file
 */
export type StagedFileStatus = "staged" | "accepted" | "rejected";

/**
 * A generated file that lives in the session temp directory, waiting to be
 * accepted into the project.
 */
export interface StagedFile {
    filename: string; // relative path, e.g. "Dockerfile" or "k8s/deployment.yaml"
    content: string;
    stagedPath: string; // absolute path inside the session temp dir
    status: StagedFileStatus;
    generatedAt: number;
}

/**
 * Artifact data containing generated files tracked as staged files
 */
export interface ArtifactsData {
    stagedFiles: StagedFile[];
    savedToDisk: boolean;
}

/**
 * Image reference for built and pushed container
 */
export interface ImageData {
    repository: string;
    tag: string;
}

/**
 * Deployment tracking data
 */
export interface DeploymentData {
    appliedManifests: string[];
    timestamp: number;
}

/**
 * Verification status data
 */
export interface VerificationData {
    podsReady: boolean;
    serviceEndpoint?: string;
}

/**
 * Error tracking data
 */
export interface ErrorInfo {
    phase: Phase;
    message: string;
    retryable: boolean;
}

/**
 * Command audit log entry
 */
export interface CommandLogEntry {
    command: string;
    timestamp: number;
    exitCode?: number;
    stdout?: string; // truncated to 500 chars
    stderr?: string; // truncated to 500 chars
    phase: Phase;
    durationMs?: number;
}

/**
 * ARM resource tracking
 */
export interface ArmResource {
    type: string; // e.g. "Microsoft.ContainerRegistry/registries"
    name: string; // e.g. "myacr"
    resourceGroup: string;
    action: "used" | "created" | "modified";
}

/**
 * Complete kickstart state for a workspace
 */
export interface KickstartState {
    currentPhase: Phase;
    workspaceFolder: string;
    projectPath?: string;
    projectSource?: "workspace" | "sample" | "custom";
    analysis?: AnalysisData;
    config?: ConfigData;
    artifacts?: ArtifactsData;
    image?: ImageData;
    deployment?: DeploymentData;
    verification?: VerificationData;
    lastError?: ErrorInfo;
    auditLog?: CommandLogEntry[];
    armResources?: ArmResource[];
}

/**
 * Gets the storage key for a workspace folder
 */
function getStateKey(workspaceFolder: string): string {
    return `kickstart.state.${workspaceFolder}`;
}

/**
 * Loads the kickstart state for a workspace folder from extension context
 * @param context The extension context
 * @param workspaceFolder The workspace folder path
 * @returns The saved state, or undefined if not found
 */
export function loadState(context: vscode.ExtensionContext, workspaceFolder: string): KickstartState | undefined {
    const key = getStateKey(workspaceFolder);
    const state = context.workspaceState.get<KickstartState>(key);
    return state;
}

/**
 * Saves the kickstart state for a workspace folder to extension context
 * @param context The extension context
 * @param workspaceFolder The workspace folder path
 * @param state The state to save
 */
export async function saveState(
    context: vscode.ExtensionContext,
    workspaceFolder: string,
    state: KickstartState,
): Promise<void> {
    const key = getStateKey(workspaceFolder);
    await context.workspaceState.update(key, state);
}

/**
 * Clears the kickstart state for a workspace folder
 * @param context The extension context
 * @param workspaceFolder The workspace folder path
 */
export async function clearState(context: vscode.ExtensionContext, workspaceFolder: string): Promise<void> {
    const key = getStateKey(workspaceFolder);
    await context.workspaceState.update(key, undefined);
}

/**
 * Jumps to a specific phase, invalidating downstream state that depends on earlier phases
 * @param targetPhase The phase to jump to
 * @param state The current state
 * @returns A new state with the phase changed and downstream state cleared
 */
export function jumpToPhase(targetPhase: Phase, state: KickstartState): KickstartState {
    const newState: KickstartState = {
        ...state,
        currentPhase: targetPhase,
    };

    if (targetPhase <= Phase.ANALYZE) {
        newState.analysis = undefined;
    }

    if (targetPhase <= Phase.CONFIGURE) {
        newState.config = undefined;
    }

    if (targetPhase <= Phase.PREPARE) {
        newState.artifacts = undefined;
    }

    if (targetPhase <= Phase.BUILD) {
        newState.image = undefined;
    }

    if (targetPhase <= Phase.DEPLOY) {
        newState.deployment = undefined;
    }

    if (targetPhase <= Phase.VERIFY) {
        newState.verification = undefined;
    }

    newState.lastError = undefined;

    return newState;
}

/**
 * Creates a new initial kickstart state for a workspace folder
 * @param workspaceFolder The workspace folder path
 * @returns A new state at the ANALYZE phase
 */
export function createInitialState(workspaceFolder: string): KickstartState {
    return {
        currentPhase: Phase.ANALYZE,
        workspaceFolder,
    };
}
