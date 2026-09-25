import * as k8s from "vscode-kubernetes-tools-api";
import { Errorable, map as errmap, bind, bindAsync, bindAll, failed } from "../utils/errorable";
import { invokeKubectlCommand, streamKubectlOutput } from "../utils/kubectl";
import { validateK8sName, validateK8sNames } from "../utils/kubernetesNames";
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
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, "gadget version");

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
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, "gadget deploy");
        return bindAsync(commandResult, () => this.getGadgetVersion());
    }

    async undeploy(): Promise<Errorable<GadgetVersion>> {
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, "gadget undeploy");
        return bindAsync(commandResult, () => this.getGadgetVersion());
    }

    async runTrace(gadgetArguments: GadgetArguments): Promise<Errorable<TraceOutputItem[]>> {
        const validArguments = validateGadgetFilters(gadgetArguments);
        if (failed(validArguments)) {
            return validArguments;
        }

        const command = this.getKubectlArgs(gadgetArguments).join(" ");
        const shellResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        const linesResult = errmap(shellResult, (r) => r.stdout.split("\n"));
        const arraysResult = bindAll(linesResult, parseOutputLine);
        return errmap(arraysResult, (arrays) => arrays.flatMap((arrays) => arrays).flatMap(asFlatItems));
    }

    watchTrace(gadgetArguments: GadgetArguments): Promise<Errorable<OutputStream>> {
        const validArguments = validateGadgetFilters(gadgetArguments);
        if (failed(validArguments)) {
            return Promise.resolve(validArguments);
        }

        const args = this.getKubectlArgs(gadgetArguments);
        return streamKubectlOutput(this.kubectl, this.kubeConfigFile, args);
    }

    private getKubectlArgs(args: GadgetArguments): string[] {
        const config = getKubectlGadgetConfig();
        const tag = failed(config) ? "latest" : config.result.releaseTag;
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
        const command = `get node --no-headers -o custom-columns=":metadata.name"`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        const lines = errmap(commandResult, (sr) => sr.stdout.trim().split("\n"));
        return bind(lines, (names) => validateK8sNames(names, "subdomain", "node"));
    }

    async getNamespaces(): Promise<Errorable<string[]>> {
        const command = `get ns --no-headers -o custom-columns=":metadata.name"`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        const lines = errmap(commandResult, (sr) => sr.stdout.trim().split("\n"));
        return bind(lines, (names) => validateK8sNames(names, "label", "namespace"));
    }

    async getPods(namespace: string): Promise<Errorable<string[]>> {
        const validNamespace = validateK8sName(namespace, "label", "namespace");
        if (failed(validNamespace)) {
            return validNamespace;
        }

        const command = `get pod -n ${validNamespace.result} --no-headers -o custom-columns=":metadata.name"`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        const lines = errmap(commandResult, (sr) => sr.stdout.trim().split("\n"));
        return bind(lines, (names) => validateK8sNames(names, "subdomain", "pod"));
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

        const command = `get pod -n ${validNamespace.result} ${validPodName.result} -o jsonpath={.spec.containers[*].name}`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        const names = errmap(commandResult, (sr) => sr.stdout.trim().split(" "));
        return bind(names, (containerNames) => validateK8sNames(containerNames, "label", "container"));
    }
}

/** Re-checks trace filter names, which arrive over the webview channel. */
export function validateGadgetFilters(gadgetArguments: GadgetArguments): Errorable<void> {
    const { nodeName, namespace, podName, containerName } = gadgetArguments.filters;

    const checks: Errorable<string>[] = [];
    if (nodeName) {
        checks.push(validateK8sName(nodeName, "subdomain", "node"));
    }
    // Default and All are numeric enum members; only a string is an actual namespace name.
    if (typeof namespace === "string" && namespace.length > 0) {
        checks.push(validateK8sName(namespace, "label", "namespace"));
    }
    if (podName) {
        checks.push(validateK8sName(podName, "subdomain", "pod"));
    }
    if (containerName) {
        checks.push(validateK8sName(containerName, "label", "container"));
    }

    const firstFailure = checks.find(failed);
    if (firstFailure !== undefined && failed(firstFailure)) {
        return firstFailure;
    }

    return { succeeded: true, result: undefined };
}
