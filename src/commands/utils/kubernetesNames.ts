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

    // Label by label: one regex for the whole subdomain needs nested quantifiers, which
    // risks catastrophic backtracking on attacker-chosen input.
    return value
        .split(".")
        .every((label) => label.length > 0 && label.length <= MAX_LABEL_LENGTH && LABEL_PATTERN.test(label));
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
    const result = names.map((name) => name.trim()).filter((name) => name.length > 0);

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
    const validated = validateK8sNames([name], format, resourceDescription);
    if (!validated.succeeded) {
        return validated;
    }

    if (validated.result.length === 0) {
        return { succeeded: false, error: `The cluster returned an empty ${resourceDescription} name.` };
    }

    return { succeeded: true, result: validated.result[0] };
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
