import * as k8s from "vscode-kubernetes-tools-api";
import { Errorable, map as errmap, bind, bindAsync, bindAll, failed } from "../utils/errorable";
import { invokeKubectlCommandArgs, streamKubectlOutput } from "../utils/kubectl";
import { validateK8sName, validateK8sNames, validateK8sNamesJson } from "../utils/kubernetesNames";
import { KubernetesClusterInfo } from "../utils/clusters";
import { OutputStream } from "../utils/commands";
import { asFlatItems, parseOutputLine } from "./traceItems";
import { getKubectlGadgetConfig } from "../utils/config";
import {
    GadgetArguments,
    GadgetVersion,
    NamespaceSelection,
    TraceOutputItem,
} from "../../webview-contract/webviewDefinitions/inspektorGadget";

export interface ClusterOperations {
    getGadgetVersion(): Promise<Errorable<GadgetVersion>>;
    isInspektorGadgetRunning(): Promise<Errorable<boolean>>;
    deploy(): Promise<Errorable<GadgetVersion>>;
    undeploy(): Promise<Errorable<GadgetVersion>>;
    runTrace(gadgetArgs: GadgetArguments): Promise<Errorable<TraceOutputItem[]>>;
    watchTrace(gadgetArgs: GadgetArguments): Promise<Errorable<OutputStream>>;
    getNodes(): Promise<Errorable<string[]>>;
    getNamespaces(): Promise<Errorable<string[]>>;
    getPods(namespace: string): Promise<Errorable<string[]>>;
    getContainers(namespace: string, podName: string): Promise<Errorable<string[]>>;
}

export class KubectlClusterOperations implements ClusterOperations {
    constructor(
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly clusterInfo: KubernetesClusterInfo,
        readonly kubeConfigFile: string,
    ) {}

    async getGadgetVersion(): Promise<Errorable<GadgetVersion>> {
        const commandResult = await invokeKubectlCommandArgs(this.kubectl, this.kubeConfigFile, ["gadget", "version"]);

        function setNullIfNotInstalled(version: string) {
            return version === "not available" ? null : version;
        }

        return errmap(commandResult, (sr) => {
            const lines = sr.stdout.split("\n").filter((l) => l.trim().length);
            return {
                client: lines[0].replace(/^Client\sversion:\s*/, ""),
                server: setNullIfNotInstalled(lines[1].replace(/^Server\sversion:\s*/, "")),
            };
        });
    }

    async isInspektorGadgetRunning(): Promise<Errorable<boolean>> {
        const version = await this.getGadgetVersion();
        if (failed(version)) {
            return { succeeded: false, error: version.error };
        }

        // If server version is non-null, Inspektor Gadget is running
        return { succeeded: true, result: !!version.result.server };
    }

    async deploy(): Promise<Errorable<GadgetVersion>> {
        const commandResult = await invokeKubectlCommandArgs(this.kubectl, this.kubeConfigFile, ["gadget", "deploy"]);
        return bindAsync(commandResult, () => this.getGadgetVersion());
    }

    async undeploy(): Promise<Errorable<GadgetVersion>> {
        const commandResult = await invokeKubectlCommandArgs(this.kubectl, this.kubeConfigFile, ["gadget", "undeploy"]);
        return bindAsync(commandResult, () => this.getGadgetVersion());
    }

    async runTrace(gadgetArguments: GadgetArguments): Promise<Errorable<TraceOutputItem[]>> {
        const validArguments = validateGadgetArguments(gadgetArguments);
        if (failed(validArguments)) {
            return validArguments;
        }

        const shellResult = await invokeKubectlCommandArgs(
            this.kubectl,
            this.kubeConfigFile,
            this.getKubectlArgs(validArguments.result),
        );
        const linesResult = errmap(shellResult, (r) => r.stdout.split("\n"));
        const arraysResult = bindAll(linesResult, parseOutputLine);
        return errmap(arraysResult, (arrays) => arrays.flatMap((arrays) => arrays).flatMap(asFlatItems));
    }

    watchTrace(gadgetArguments: GadgetArguments): Promise<Errorable<OutputStream>> {
        const validArguments = validateGadgetArguments(gadgetArguments);
        if (failed(validArguments)) {
            return Promise.resolve(validArguments);
        }

        const args = this.getKubectlArgs(validArguments.result);
        return streamKubectlOutput(this.kubectl, this.kubeConfigFile, args);
    }

    private getKubectlArgs(args: GadgetArguments): string[] {
        const config = getKubectlGadgetConfig();
        const configuredTag = failed(config) ? "latest" : config.result.releaseTag;
        const tag = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(configuredTag) ? configuredTag : "latest";
        const gadgetImageName = `${args.gadgetCategory}_${args.gadgetResource.replace(/-/g, "")}:${tag}`;
        const pluginCommand = ["gadget", "run", gadgetImageName, "-o", "json"];
        const nodeNameFilter = args.filters.nodeName ? ["--node", args.filters.nodeName] : [];
        const namespaceFilter =
            args.filters.namespace === NamespaceSelection.Default
                ? []
                : args.filters.namespace === NamespaceSelection.All
                  ? ["--all-namespaces"]
                  : ["--namespace", args.filters.namespace];
        const podFilter = args.filters.podName ? ["--podname", args.filters.podName] : [];
        const containerFilter = args.filters.containerName ? ["--containername", args.filters.containerName] : [];
        const labelFilter = args.filters.labels
            ? [
                  "--selector",
                  Object.entries(args.filters.labels)
                      .map((kv) => `${kv[0]}=${kv[1]}`)
                      .join(","),
              ]
            : [];
        const sort = args.sortString ? ["--sort", args.sortString] : [];
        const limit = args.maxRows ? ["--max-entries", args.maxRows.toString()] : [];
        const timeout = args.timeout ? ["--timeout", args.timeout.toString()] : [];
        return [
            ...pluginCommand,
            ...nodeNameFilter,
            ...namespaceFilter,
            ...podFilter,
            ...containerFilter,
            ...labelFilter,
            ...sort,
            ...limit,
            ...timeout,
        ];
    }

    async getNodes(): Promise<Errorable<string[]>> {
        const args = ["get", "node", "-o", "json"];
        const commandResult = await invokeKubectlCommandArgs(this.kubectl, this.kubeConfigFile, args);
        return bind(commandResult, (sr) => validateK8sNamesJson(sr.stdout, "subdomain", "node"));
    }

    async getNamespaces(): Promise<Errorable<string[]>> {
        const args = ["get", "ns", "-o", "json"];
        const commandResult = await invokeKubectlCommandArgs(this.kubectl, this.kubeConfigFile, args);
        return bind(commandResult, (sr) => validateK8sNamesJson(sr.stdout, "label", "namespace"));
    }

    async getPods(namespace: string): Promise<Errorable<string[]>> {
        const validNamespace = validateK8sName(namespace, "label", "namespace");
        if (failed(validNamespace)) {
            return validNamespace;
        }

        const args = ["get", "pod", "-n", validNamespace.result, "-o", "json"];
        const commandResult = await invokeKubectlCommandArgs(this.kubectl, this.kubeConfigFile, args);
        return bind(commandResult, (sr) => validateK8sNamesJson(sr.stdout, "subdomain", "pod"));
    }

    async getContainers(namespace: string, podName: string): Promise<Errorable<string[]>> {
        const validNamespace = validateK8sName(namespace, "label", "namespace");
        if (failed(validNamespace)) {
            return validNamespace;
        }

        const validPodName = validateK8sName(podName, "subdomain", "pod");
        if (failed(validPodName)) {
            return validPodName;
        }

        const args = ["get", "pod", "-n", validNamespace.result, validPodName.result, "-o", "json"];
        const commandResult = await invokeKubectlCommandArgs(this.kubectl, this.kubeConfigFile, args);
        return bind(commandResult, (sr) => {
            try {
                const pod = JSON.parse(sr.stdout) as { spec?: { containers?: Array<{ name?: unknown }> } };
                if (!Array.isArray(pod.spec?.containers)) {
                    return { succeeded: false, error: "The cluster returned an invalid pod definition." };
                }
                const names = pod.spec.containers.map((container) => container.name);
                if (names.some((name) => typeof name !== "string")) {
                    return { succeeded: false, error: "The cluster returned an invalid container name." };
                }
                return validateK8sNames(names as string[], "label", "container");
            } catch {
                return { succeeded: false, error: "The cluster returned invalid JSON for a pod." };
            }
        });
    }
}

const GADGET_RESOURCES: Readonly<Record<string, readonly string[]>> = {
    profile: ["cpu"],
    snapshot: ["process", "socket"],
    top: ["block-io", "file", "tcp"],
    trace: ["dns", "exec", "tcp"],
};
const LABEL_PREFIX_PATTERN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const LABEL_NAME_PATTERN = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const LABEL_VALUE_PATTERN = /^$|^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const SORT_PATTERN = /^-?[A-Za-z0-9][A-Za-z0-9./]*(?:,-?[A-Za-z0-9][A-Za-z0-9./]*)*$/;

/** Re-checks a complete trace request after it crosses the webview boundary. */
export function validateGadgetArguments(gadgetArguments: GadgetArguments): Errorable<GadgetArguments> {
    if (
        typeof gadgetArguments.gadgetCategory !== "string" ||
        typeof gadgetArguments.gadgetResource !== "string" ||
        typeof gadgetArguments.filters !== "object" ||
        gadgetArguments.filters === null
    ) {
        return { succeeded: false, error: "The trace request is malformed." };
    }

    const allowedResources = GADGET_RESOURCES[gadgetArguments.gadgetCategory];
    if (!allowedResources?.includes(gadgetArguments.gadgetResource)) {
        return { succeeded: false, error: "The trace request contains an unsupported gadget." };
    }

    const { nodeName, namespace, podName, containerName } = gadgetArguments.filters;

    const checks: Errorable<string>[] = [];
    if (nodeName !== undefined && typeof nodeName !== "string") {
        return { succeeded: false, error: "The trace request contains an invalid node name." };
    }
    if (nodeName) {
        checks.push(validateK8sName(nodeName, "subdomain", "node"));
    }
    // Default and All are numeric enum members; only a string is an actual namespace name.
    if (typeof namespace === "string") {
        checks.push(validateK8sName(namespace, "label", "namespace"));
    }
    if (podName !== undefined && typeof podName !== "string") {
        return { succeeded: false, error: "The trace request contains an invalid pod name." };
    }
    if (podName) {
        checks.push(validateK8sName(podName, "subdomain", "pod"));
    }
    if (containerName !== undefined && typeof containerName !== "string") {
        return { succeeded: false, error: "The trace request contains an invalid container name." };
    }
    if (containerName) {
        checks.push(validateK8sName(containerName, "label", "container"));
    }

    const firstFailure = checks.find(failed);
    if (firstFailure !== undefined && failed(firstFailure)) {
        return firstFailure;
    }

    if (
        typeof namespace !== "string" &&
        namespace !== NamespaceSelection.Default &&
        namespace !== NamespaceSelection.All
    ) {
        return { succeeded: false, error: "The trace request contains an invalid namespace selection." };
    }

    const labels = gadgetArguments.filters.labels;
    if (labels !== undefined && (typeof labels !== "object" || labels === null || Array.isArray(labels))) {
        return { succeeded: false, error: "The trace request contains an invalid label selector." };
    }
    for (const [key, value] of Object.entries(labels ?? {})) {
        const keyParts = key.split("/");
        const name = keyParts.at(-1) ?? "";
        const prefix = keyParts.length === 2 ? keyParts[0] : undefined;
        const validKey =
            keyParts.length <= 2 &&
            name.length <= 63 &&
            LABEL_NAME_PATTERN.test(name) &&
            (prefix === undefined || (prefix.length <= 253 && LABEL_PREFIX_PATTERN.test(prefix)));
        if (typeof value !== "string" || value.length > 63 || !validKey || !LABEL_VALUE_PATTERN.test(value)) {
            return { succeeded: false, error: "The trace request contains an invalid label selector." };
        }
    }

    if (
        gadgetArguments.sortString !== undefined &&
        (typeof gadgetArguments.sortString !== "string" || !SORT_PATTERN.test(gadgetArguments.sortString))
    ) {
        return { succeeded: false, error: "The trace request contains an invalid sort expression." };
    }

    for (const [name, value] of [
        ["maximum row count", gadgetArguments.maxRows],
        ["timeout", gadgetArguments.timeout],
    ] as const) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
            return { succeeded: false, error: `The trace request contains an invalid ${name}.` };
        }
    }

    return { succeeded: true, result: gadgetArguments };
}

// Retained as the public name used by existing callers and tests.
export const validateGadgetFilters = validateGadgetArguments;
