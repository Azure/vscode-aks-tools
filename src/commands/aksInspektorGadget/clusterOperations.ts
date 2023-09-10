import * as k8s from 'vscode-kubernetes-tools-api';
import { Errorable, map as errmap, bindAsync, bindAll } from '../utils/errorable';
import { invokeKubectlCommand, streamKubectlOutput } from '../utils/kubectl';
import { KubernetesClusterInfo } from '../utils/clusters';
import { OutputStream } from '../utils/commands';
import { asFlatItems, parseOutputLine } from './traceItems';
import { GadgetArguments, GadgetVersion, NamespaceSelection, TraceOutputItem } from '../../webview-contract/webviewDefinitions/inspektorGadget';

export interface ClusterOperations {
    getGadgetVersion(): Promise<Errorable<GadgetVersion>>;
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
        readonly kubeConfigFile: string
    ) { }

    async getGadgetVersion(): Promise<Errorable<GadgetVersion>> {
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, "gadget version");

        function setNullIfNotInstalled(version: string) {
            return version === "not installed" ? null : version;
        }

        return errmap(commandResult, sr => {
            const lines = sr.stdout.split('\n').filter(l => l.trim().length);
            return {
                client: lines[0].replace(/^Client\sversion:\s*/, ''),
                server: setNullIfNotInstalled(lines[1].replace(/^Server\sversion:\s*/, ''))
            };
        });
    }

    async deploy(): Promise<Errorable<GadgetVersion>> {
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, "gadget deploy");
        return bindAsync(commandResult, _ => this.getGadgetVersion());
    }

    async undeploy(): Promise<Errorable<GadgetVersion>> {
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, "gadget undeploy");
        return bindAsync(commandResult, _ => this.getGadgetVersion());
    }

    async runTrace(gadgetArguments: GadgetArguments): Promise<Errorable<TraceOutputItem[]>> {
        const command = this._getKubectlArgs(gadgetArguments).join(' ');
        const shellResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        const linesResult = errmap(shellResult, r => r.stdout.split('\n'));
        const arraysResult = bindAll(linesResult, parseOutputLine);
        return errmap(arraysResult, arrays => arrays.flatMap(arrays => arrays).flatMap(asFlatItems));
    }

    watchTrace(gadgetArguments: GadgetArguments): Promise<Errorable<OutputStream>> {
        const args = this._getKubectlArgs(gadgetArguments);
        return streamKubectlOutput(this.kubectl, this.kubeConfigFile, args);
    }

    private _getKubectlArgs(args: GadgetArguments): string[] {
        const pluginCommand = ["gadget", args.gadgetCategory, args.gadgetResource, "--output", "json"];
        const nodeNameFilter = args.filters.nodeName ? ["--node", args.filters.nodeName] : [];
        const namespaceFilter =
            args.filters.namespace === NamespaceSelection.Default ? [] :
            args.filters.namespace === NamespaceSelection.All ? ["--all-namespaces"] :
            ["--namespace", args.filters.namespace];
        const podFilter = args.filters.podName ? ["--podname", args.filters.podName] : [];
        const containerFilter = args.filters.containerName ? ["--containername", args.filters.containerName] : [];
        const labelFilter = args.filters.labels ? ["--selector", Object.entries(args.filters.labels).map(kv => `${kv[0]}=${kv[1]}`).join(',')] : [];
        const sort = args.sortString ? ["--sort", args.sortString] : [];
        const limit = args.maxRows ? ["--max-rows", args.maxRows.toString()] : [];
        const interval = args.interval ? ["--interval", args.interval.toString()] : [];
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
            ...interval,
            ...timeout
        ];
    }

    async getNodes(): Promise<Errorable<string[]>> {
        const command = `get node --no-headers -o custom-columns=":metadata.name"`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        return errmap(commandResult, sr => sr.stdout.trim().split("\n"));
    }

    async getNamespaces(): Promise<Errorable<string[]>> {
        const command = `get ns --no-headers -o custom-columns=":metadata.name"`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        return errmap(commandResult, sr => sr.stdout.trim().split("\n"));
    }

    async getPods(namespace: string): Promise<Errorable<string[]>> {
        const command = `get pod -n ${namespace} --no-headers -o custom-columns=":metadata.name"`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        return errmap(commandResult, sr => sr.stdout.trim().split("\n"));
    }

    async getContainers(namespace: string, podName: string): Promise<Errorable<string[]>> {
        const command = `get pod -n ${namespace} ${podName} -o jsonpath={.spec.containers[*].name}`;
        const commandResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFile, command);
        return errmap(commandResult, sr => sr.stdout.trim().split(" "));
    }
}
