// Helpers for building the `retina capture create` command and the on-node
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
 * Builds the `kubectl-retina capture create` argument string (binary invoked
 * directly, not via `kubectl retina`). Callers must run it with KUBECONFIG set;
 * retina v1.x ignores the `--kubeconfig` flag for capture create.
 */
export function buildRetinaCaptureCommand(options: RetinaCaptureCommandOptions): string {
    const parts = ["capture create", "--namespace default", `--name ${options.captureName}`];

    if (options.blobUploadSasUri) {
        parts.push(
            `--node-selectors "kubernetes.io/os=linux"`,
            `--node-names "${options.nodeNames}"`,
            "--no-wait=false",
            `--blob-upload="${options.blobUploadSasUri}"`,
        );
    } else {
        parts.push(
            `--host-path ${RETINA_CAPTURE_HOST_PATH_SUBPATH}`,
            `--host-path-base-dir ${RETINA_CAPTURE_HOST_PATH_BASE_DIR}`,
            `--node-selectors "kubernetes.io/os=linux"`,
            `--node-names "${options.nodeNames}"`,
            "--no-wait=false",
        );
    }

    return parts.join(" ");
}
