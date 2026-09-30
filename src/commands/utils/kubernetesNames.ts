import { Errorable } from "./errorable";

/**
 * Validation for object names served by a Kubernetes API server. kubectl does no
 * client-side validation on read, so a hostile endpoint can return anything for
 * `metadata.name`, and several features interpolate those names into kubectl command
 * strings that run through a shell. A conforming API server only ever assigns DNS-1123
 * names. See docs/book/src/development/development.md.
 */

/** `label` covers namespaces and containers; `subdomain` covers nodes, pods and CRDs. */
export type K8sNameFormat = "label" | "subdomain";

const LABEL_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const SUBDOMAIN_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const MAX_LABEL_LENGTH = 63;
const MAX_SUBDOMAIN_LENGTH = 253;

/** https://kubernetes.io/docs/concepts/overview/working-with-objects/names/ */
export function isValidK8sName(value: string, format: K8sNameFormat): boolean {
    if (format === "label") {
        return value.length > 0 && value.length <= MAX_LABEL_LENGTH && LABEL_PATTERN.test(value);
    }

    if (value.length === 0 || value.length > MAX_SUBDOMAIN_LENGTH) {
        return false;
    }

    // Match Kubernetes' IsDNS1123Subdomain validator. Unlike DNS labels, Kubernetes
    // does not impose a separate 63-character limit on each dot-delimited component.
    return SUBDOMAIN_PATTERN.test(value);
}

/**
 * Validates names read back from the cluster, dropping the blank line kubectl emits for
 * an empty list. Fails the whole list rather than filtering: an invalid name means the
 * endpoint is misbehaving, which the user should be told about.
 */
export function validateK8sNames(
    names: string[],
    format: K8sNameFormat,
    resourceDescription: string,
): Errorable<string[]> {
    // Callers remove kubectl's trailing line ending before splitting. Do not trim an
    // individual value: validating one representation and executing another is unsafe.
    const result = names.filter((name) => name.length > 0);

    const invalid = result.find((name) => !isValidK8sName(name, format));
    if (invalid !== undefined) {
        return {
            succeeded: false,
            error:
                `The cluster returned a ${resourceDescription} name that is not a valid Kubernetes name: ${describeInvalidName(invalid)}. ` +
                `This should not be possible for a healthy cluster, so the connection is being treated as untrusted. ` +
                `Check that the current kubeconfig points at a cluster you trust.`,
        };
    }

    return { succeeded: true, result };
}

/** Validates a single name read back from the cluster. */
export function validateK8sName(name: string, format: K8sNameFormat, resourceDescription: string): Errorable<string> {
    if (name.trim().length === 0) {
        return { succeeded: false, error: `The cluster returned an empty ${resourceDescription} name.` };
    }

    const validated = validateK8sNames([name], format, resourceDescription);
    if (!validated.succeeded) {
        return validated;
    }

    if (validated.result.length === 0) {
        return { succeeded: false, error: `The cluster returned an empty ${resourceDescription} name.` };
    }

    return { succeeded: true, result: validated.result[0] };
}

/** Parses a Kubernetes list response without losing delimiters embedded in a hostile name. */
export function validateK8sNamesJson(
    json: string,
    format: K8sNameFormat,
    resourceDescription: string,
): Errorable<string[]> {
    try {
        const parsed = JSON.parse(json) as { items?: Array<{ metadata?: { name?: unknown } }> };
        if (!Array.isArray(parsed.items)) {
            return { succeeded: false, error: "The cluster returned an invalid Kubernetes resource list." };
        }

        const names = parsed.items.map((item) => item.metadata?.name);
        if (names.some((name) => typeof name !== "string")) {
            return { succeeded: false, error: `The cluster returned an invalid ${resourceDescription} name.` };
        }
        return validateK8sNames(names as string[], format, resourceDescription);
    } catch {
        return { succeeded: false, error: "The cluster returned invalid JSON for a Kubernetes resource list." };
    }
}

/** Quoted so metacharacters are visible, truncated so a payload cannot flood the error. */
function describeInvalidName(name: string): string {
    const maxDisplayLength = 100;
    const truncated = name.length > maxDisplayLength ? `${name.slice(0, maxDisplayLength)}...` : name;
    return JSON.stringify(truncated);
}

/**
 * Reduces an arbitrary string to characters legal in a DNS-1123 label. For values the
 * extension derives a name from rather than reads back: kubeconfig context names are not
 * DNS-1123 (`arn:aws:eks:...`, `user@cluster`) so they cannot be validated, only reduced.
 * Returns "unknown" if nothing usable is left. `maxLength` must leave room for any prefix.
 */
export function toSafeK8sNameFragment(value: string, maxLength: number = MAX_LABEL_LENGTH): string {
    const reduced = value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, maxLength)
        .replace(/-+$/g, "");

    return reduced.length > 0 ? reduced : "unknown";
}
