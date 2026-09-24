import { Errorable } from "../utils/errorable";
import { execFile, ShellOptions, ShellResult } from "../utils/shell";

// Helpers for building the `retina capture create` arguments and the on-node
// artifact location. Retina v1.x rejects an absolute `--host-path` (must be a
// relative subpath under `--host-path-base-dir`); these constants keep the
// command and the node-explorer hostPath mount (RetinaCapturePanel) in sync.

export const RETINA_CAPTURE_HOST_PATH_BASE_DIR = "/mnt";
export const RETINA_CAPTURE_HOST_PATH_SUBPATH = "capture";
export const RETINA_CAPTURE_NODE_HOST_PATH = `${RETINA_CAPTURE_HOST_PATH_BASE_DIR}/${RETINA_CAPTURE_HOST_PATH_SUBPATH}`;

export interface RetinaCaptureCommandOptions {
    captureName: string;
    nodeNames: string;
    /** When set, the capture is uploaded to blob storage instead of the node host-path. */
    blobUploadSasUri?: string;
}

/**
 * Builds the `kubectl-retina capture create` argument array. Values can come
 * from kubeconfig context names, cluster node names, and signed URLs, so callers
 * must pass this array to `execFile` rather than interpolate it into a shell
 * command. Callers must run it with KUBECONFIG set; retina v1.x ignores the
 * `--kubeconfig` flag for capture create.
 */
export function buildRetinaCaptureArgs(options: RetinaCaptureCommandOptions): string[] {
    const args = ["capture", "create", "--namespace", "default", "--name", options.captureName];

    if (options.blobUploadSasUri) {
        args.push(
            "--node-selectors",
            "kubernetes.io/os=linux",
            "--node-names",
            options.nodeNames,
            "--no-wait=false",
            "--blob-upload",
            options.blobUploadSasUri,
        );
    } else {
        args.push(
            "--host-path",
            RETINA_CAPTURE_HOST_PATH_SUBPATH,
            "--host-path-base-dir",
            RETINA_CAPTURE_HOST_PATH_BASE_DIR,
            "--node-selectors",
            "kubernetes.io/os=linux",
            "--node-names",
            options.nodeNames,
            "--no-wait=false",
        );
    }

    return args;
}

/**
 * Runs kubectl-retina without a shell. Context names are user-controlled in
 * kubeconfig files, while node names and signed URLs come from external systems;
 * keeping every value in the argv array prevents shell metacharacter injection.
 */
export function runRetinaCapture(
    executable: string,
    options: RetinaCaptureCommandOptions,
    shellOptions: ShellOptions,
): Promise<Errorable<ShellResult>> {
    return execFile(executable, buildRetinaCaptureArgs(options), shellOptions);
}
