import { KubeConfig } from "@kubernetes/client-node";
import type { ApiConstructor, ApiType } from "@kubernetes/client-node";
import * as yaml from "js-yaml";
import { Errorable, failed, getErrorMessage } from "./errorable";

const maximumKubeconfigBytes = 1024 * 1024;

/**
 * Creates a typed Kubernetes API client from trusted in-memory kubeconfig YAML.
 *
 * Keep client construction here so features depend on Kubernetes APIs rather than
 * on how kubeconfig authentication and transport are initialized.
 */
export function createKubernetesClient<TClient extends ApiType>(
    kubeconfigYaml: string,
    apiClientType: ApiConstructor<TClient>,
): Errorable<TClient> {
    try {
        if (Buffer.byteLength(kubeconfigYaml, "utf8") > maximumKubeconfigBytes) {
            return { succeeded: false, error: "Kubeconfig is larger than the 1 MiB safety limit." };
        }

        const rawValidation = validateRawKubeConfig(kubeconfigYaml);
        if (failed(rawValidation)) return rawValidation;

        const kubeConfig = new KubeConfig();
        kubeConfig.loadFromString(kubeconfigYaml);

        const validation = validateKubeConfig(kubeConfig);
        if (failed(validation)) return validation;

        return { succeeded: true, result: kubeConfig.makeApiClient(apiClientType) };
    } catch (error) {
        return {
            succeeded: false,
            error: `Failed to create Kubernetes API client: ${getErrorMessage(error)}`,
        };
    }
}

export function replaceKubeconfigUserAuthWithToken(kubeconfigYaml: string, token: string): Errorable<string> {
    if (Buffer.byteLength(kubeconfigYaml, "utf8") > maximumKubeconfigBytes) {
        return { succeeded: false, error: "Kubeconfig is larger than the 1 MiB safety limit." };
    }
    if (!token) {
        return { succeeded: false, error: "Kubernetes access token is empty." };
    }

    const parsed = parseKubeconfigYaml(kubeconfigYaml);
    if (failed(parsed)) return parsed;

    const currentContextName = parsed.result["current-context"];
    const clusters = parsed.result.clusters;
    const contexts = parsed.result.contexts;
    const users = parsed.result.users;
    if (
        typeof currentContextName !== "string" ||
        !Array.isArray(clusters) ||
        !Array.isArray(contexts) ||
        !Array.isArray(users)
    ) {
        return { succeeded: false, error: "Kubeconfig does not define a current context and user." };
    }

    const currentContext = contexts.find(
        (entry) => isRecord(entry) && entry.name === currentContextName && isRecord(entry.context),
    );
    const contextDetails =
        isRecord(currentContext) && isRecord(currentContext.context) ? currentContext.context : undefined;
    const clusterName = contextDetails?.cluster;
    const userName = contextDetails?.user;
    if (typeof clusterName !== "string" || typeof userName !== "string") {
        return { succeeded: false, error: "Kubeconfig current context does not identify a cluster and user." };
    }

    const currentCluster = clusters.find((entry) => isRecord(entry) && entry.name === clusterName);
    const currentUser = users.find((entry) => isRecord(entry) && entry.name === userName);
    if (!isRecord(currentCluster) || !isRecord(currentUser)) {
        return { succeeded: false, error: "Kubeconfig does not define the current context cluster and user." };
    }

    return {
        succeeded: true,
        result: yaml.dump({
            apiVersion: "v1",
            kind: "Config",
            clusters: [currentCluster],
            contexts: [currentContext],
            "current-context": currentContextName,
            users: [{ name: userName, user: { token } }],
        }),
    };
}

function validateKubeConfig(kubeConfig: KubeConfig): Errorable<void> {
    const cluster = kubeConfig.getCurrentCluster();
    if (!cluster) {
        return { succeeded: false, error: "Kubeconfig does not have an active cluster." };
    }

    let serverUrl: URL;
    try {
        serverUrl = new URL(cluster.server);
    } catch {
        return { succeeded: false, error: "Kubeconfig contains an invalid API server URL." };
    }
    if (serverUrl.protocol !== "https:") {
        return { succeeded: false, error: "Kubernetes API clients require an HTTPS server URL." };
    }
    if (serverUrl.username || serverUrl.password) {
        return { succeeded: false, error: "Kubernetes API server URLs cannot contain credentials." };
    }
    if (cluster.skipTLSVerify) {
        return { succeeded: false, error: "Kubernetes API clients require TLS certificate verification." };
    }
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
        return {
            succeeded: false,
            error: "Kubernetes API clients cannot run while NODE_TLS_REJECT_UNAUTHORIZED disables TLS verification.",
        };
    }

    const user = kubeConfig.getCurrentUser();
    if (user?.exec || user?.authProvider || user?.certFile || user?.keyFile || user?.username || user?.password) {
        return { succeeded: false, error: "Kubeconfig uses an unsupported authentication mechanism." };
    }
    const hasToken = typeof user?.token === "string" && user.token.length > 0;
    const hasClientCertificate = typeof user?.certData === "string" && typeof user.keyData === "string";
    if (hasToken === hasClientCertificate) {
        return { succeeded: false, error: "Kubeconfig must contain exactly one supported authentication mechanism." };
    }

    return { succeeded: true, result: undefined };
}

function validateRawKubeConfig(kubeconfigYaml: string): Errorable<void> {
    const parsed = parseKubeconfigYaml(kubeconfigYaml);
    if (failed(parsed)) return parsed;
    const rawConfig = parsed.result;

    const clusters = rawConfig.clusters;
    if (clusters !== undefined && !Array.isArray(clusters)) {
        return { succeeded: false, error: "Kubeconfig clusters must be an array." };
    }
    for (const entry of clusters ?? []) {
        if (!isRecord(entry) || !isRecord(entry.cluster)) {
            return { succeeded: false, error: "Kubeconfig contains an invalid cluster entry." };
        }
        if ("certificate-authority" in entry.cluster) {
            return { succeeded: false, error: "Kubeconfig must contain inline certificate authority data." };
        }
        if ("proxy-url" in entry.cluster) {
            return { succeeded: false, error: "Kubeconfig proxy URLs are not supported." };
        }
    }

    const users = rawConfig.users;
    if (users !== undefined && !Array.isArray(users)) {
        return { succeeded: false, error: "Kubeconfig users must be an array." };
    }
    for (const entry of users ?? []) {
        if (!isRecord(entry) || !isRecord(entry.user)) {
            return { succeeded: false, error: "Kubeconfig contains an invalid user entry." };
        }

        const user = entry.user;
        const supportedFields = new Set(["token", "client-certificate-data", "client-key-data"]);
        if (Object.keys(user).some((field) => !supportedFields.has(field))) {
            return { succeeded: false, error: "Kubeconfig uses an unsupported authentication mechanism." };
        }

        if (user.token !== undefined && typeof user.token !== "string") {
            return { succeeded: false, error: "Kubeconfig contains an invalid inline token." };
        }
        const certificateData = user["client-certificate-data"];
        const keyData = user["client-key-data"];
        if (
            (certificateData !== undefined && typeof certificateData !== "string") ||
            (keyData !== undefined && typeof keyData !== "string") ||
            (certificateData === undefined) !== (keyData === undefined)
        ) {
            return { succeeded: false, error: "Kubeconfig must contain a complete inline client certificate." };
        }
        const hasToken = typeof user.token === "string" && user.token.length > 0;
        const hasClientCertificate = typeof certificateData === "string" && typeof keyData === "string";
        if (hasToken === hasClientCertificate) {
            return {
                succeeded: false,
                error: "Kubeconfig must contain exactly one supported authentication mechanism.",
            };
        }
    }

    return { succeeded: true, result: undefined };
}

function parseKubeconfigYaml(kubeconfigYaml: string): Errorable<Record<string, unknown>> {
    let rawConfig: unknown;
    try {
        rawConfig = yaml.load(kubeconfigYaml);
    } catch (error) {
        return { succeeded: false, error: `Failed to parse kubeconfig YAML: ${getErrorMessage(error)}` };
    }

    return isRecord(rawConfig)
        ? { succeeded: true, result: rawConfig }
        : { succeeded: false, error: "Kubeconfig must contain a YAML object." };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
