import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { GadgetArguments, GadgetVersion, InitialState, ToVsCodeMsgDef, ToWebViewMsgDef, TraceOutputItem } from "../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { InspektorGadget } from "../InspektorGadget/InspektorGadget";
import { getGadgetMetadata } from "../InspektorGadget/helpers/gadgets";
import { GadgetCategory, isDerivedProperty } from "../InspektorGadget/helpers/gadgets/types";
import { stateUpdater } from "../InspektorGadget/helpers/state";
import { distinct, exclude } from "../utilities/array";
import { Scenario } from "../utilities/manualTest";

type ContainerInfo = { name: string, pid: number, mountNsId: number, comm: string, ppid: number, tids: number[] };
type PodContainers = { [podName: string]: ContainerInfo[] };
type NamespaceResources = { [namespace: string]: PodContainers };
type NodeResources = { [node: string]: NamespaceResources };

const nodeResources: NodeResources = {
    "testnode01": {
        "kube-system": {
            "konnectivity-agent-00001": [{name: "konnectivity-agent", pid: 1000, mountNsId: 4000000000, comm: "proxy-agent", ppid: 100, tids: [10000]}],
            "coredns-00001": [{name: "coredns", pid: 1001, mountNsId: 4000000001, comm: "coredns", ppid: 101, tids: [10001]}]
        },
        "default": {
            "testpod-00001": [
                {name: "testpod", pid: 1002, mountNsId: 4000000002, comm: "testapp", ppid: 102, tids: [10002]},
                {name: "testsidecar", pid: 1003, mountNsId: 4000000003, comm: "test2", ppid: 103, tids: [10003,10004]}
            ]
        }
    },
    "testnode02": {
        "kube-system": {
            "konnectivity-agent-00002": [{name: "konnectivity-agent", pid: 2000, mountNsId: 4000000000, comm: "proxy-agent", ppid: 200, tids: [20000]}],
            "coredns-00002": [{name: "coredns", pid: 2001, mountNsId: 4000000001, comm: "coredns", ppid: 201, tids: [20001]}]
        },
        "default": {
            "testpod-00002": [
                {name: "testpod", pid: 2002, mountNsId: 4000000002, comm: "testapp", ppid: 202, tids: [20002]},
                {name: "testsidecar", pid: 2003, mountNsId: 4000000003, comm: "test2", ppid: 203, tids: [20003,20004]}
            ]
        }
    }
}

function getNamespaces(node: string): string[] {
    const thisNodeResources = nodeResources[node];
    if (!thisNodeResources) {
        return [];
    }
    return Object.keys(thisNodeResources);
}

function getPodNames(node: string, namespace: string): string[] {
    if (!getNamespaces(node).includes(namespace)) {
        return [];
    }
    return Object.keys(nodeResources[node][namespace]);
}

function getContainers(node: string, namespace: string, pod: string): string[] {
    if (!getPodNames(node, namespace).includes(pod)) {
        return [];
    }
    return nodeResources[node][namespace][pod].map(c => c.name);
}

const nodes = Object.keys(nodeResources);

export function getInspektorGadgetScenarios() {
    let version: GadgetVersion = {client: "1.0.0", server: "1.0.0" };
    let watchTimer: NodeJS.Timer;

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getVersionRequest: handleGetVersionRequest,
            deployRequest: handleDeployRequest,
            undeployRequest: handleUndeployRequest,
            runStreamingTraceRequest: args => handleRunStreamingTraceRequest(args.traceId, args.arguments),
            runBlockingTraceRequest: args => handleRunBlockingTraceRequest(args.traceId, args.arguments),
            stopStreamingTraceRequest: handleStopWatchingTraceRequest,
            getNodesRequest: handleGetNodesRequest,
            getNamespacesRequest: handleGetNamespacesRequest,
            getPodsRequest: args => handleGetPodsRequest(args.namespace),
            getContainersRequest: args => handleGetContainersRequest(args.namespace, args.podName)
        };

        async function handleGetVersionRequest() {
            await new Promise(resolve => setTimeout(resolve, 1000));
            webview.postUpdateVersion(version);
        }
    
        async function handleDeployRequest() {
            await new Promise(resolve => setTimeout(resolve, 1000));
            version = { client: "1.0.0", server: "1.0.0" };
            webview.postUpdateVersion(version);
        }
    
        async function handleUndeployRequest() {
            await new Promise(resolve => setTimeout(resolve, 1000));
            version = { client: "1.0.0", server: null };
            webview.postUpdateVersion(version);
        }
    
        function handleRunStreamingTraceRequest(traceId: number, args: GadgetArguments) {
            if (watchTimer) {
                clearInterval(watchTimer);
            }
    
            const refreshIntervalMs = (args.interval || 1) * 1000;
            watchTimer = setInterval(() => emitTraceOutput(args, traceId), refreshIntervalMs);
        }
    
        async function handleRunBlockingTraceRequest(traceId: number, args: GadgetArguments) {
            const useSpecifiedTimeout = args.gadgetCategory === "profile" && args.timeout;
            const waitTime = useSpecifiedTimeout ? args.timeout! * 1000 : 2000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            const items = Array.from({ length: 10 }, _ => getTraceItem(args));
            webview.postRunTraceResponse({items, traceId});
        }
    
        function handleStopWatchingTraceRequest() {
            if (watchTimer) {
                clearInterval(watchTimer);
            }
        }
    
        async function handleGetNodesRequest() {
            await new Promise(resolve => setTimeout(resolve, 1000));
            webview.postGetNodesResponse({nodes});
        }
    
        async function handleGetNamespacesRequest() {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const namespaces = distinct(nodes.flatMap(node => getNamespaces(node)));
            webview.postGetNamespacesResponse({namespaces});
        }
    
        async function handleGetPodsRequest(namespace: string) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const podNames = distinct(nodes.flatMap(node => getPodNames(node, namespace)));
            webview.postGetPodsResponse({namespace, podNames});
        }
    
        async function handleGetContainersRequest(namespace: string, podName: string) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const containerNames = distinct(nodes.flatMap(node => getContainers(node, namespace, podName)));
            webview.postGetContainersResponse({namespace, podName, containerNames});
        }
    
        function emitTraceOutput(config: GadgetArguments, traceId: number) {
            const isTopTrace = config.gadgetCategory === "top";
            if (isTopTrace) {
                const maxRows = config.maxRows!;
                const items = Array.from({ length: maxRows }, _ => getTraceItem(config));
                webview.postRunTraceResponse({items, traceId});
            } else {
                const items = [getTraceItem(config)];
                webview.postRunTraceResponse({items, traceId});
            }
        }
    }

    function getTraceItem(gadgetArgs: GadgetArguments): TraceOutputItem {
        const gadgetMetadata = getGadgetMetadata(gadgetArgs.gadgetCategory as GadgetCategory, gadgetArgs.gadgetResource);
        const expectedKeys = gadgetMetadata?.allProperties.filter(p => !isDerivedProperty(p)).map(p => p.key) || [];
        const node = nodes[~~(Math.random() * nodes.length)];
        const namespaces = Object.keys(nodeResources[node]);
        const namespace = namespaces[~~(Math.random() * namespaces.length)];
        const pods = Object.keys(nodeResources[node][namespace]);
        const pod = pods[~~(Math.random() * pods.length)];
        const containers = nodeResources[node][namespace][pod];
        const container = containers[~~(Math.random() * containers.length)];
        const threadIds = [container.pid, ...container.tids];
        const threadId = threadIds[~~(Math.random() * threadIds.length)];

        const stats = {
            "k8s.node": node,
            "k8s.namespace": namespace,
            "k8s.podName": pod,
            "k8s.containerName": container.name,
            "processes.pid": container.pid,
            "processes.comm": container.comm,
            pid: container.pid,
            mountnsid: container.mountNsId,
            comm: container.comm,
            ppid: container.ppid,
            uid: 0,
            gid: 1,
            tid: threadId
        };

        const populatedKeys = Object.keys(stats);
        const remainingColumns = exclude(expectedKeys, populatedKeys);

        return remainingColumns.reduce<TraceOutputItem>(
            (stats, key) => {
                stats[key] = getTraceStatsValue(key);
                return stats;
            },
            stats
        );
    }

    function getTraceStatsValue(columnKey: string): any {
        const operations = ["accept", "close"];
        const protocols = ["TCP", "UDP"];
        const qrValues = ["Q", "R"];
        const packetTypes = ["HOST", "OUTGOING", "OTHERHOST"];
        const queryTypes = ["A", "AAAA"];
        const socketStatuses = ["ESTABLISHED", "LISTEN", "TIME_WAIT", "INACTIVE", "ACTIVE"];
        switch (columnKey) {
            case "family":
                return 2;
            case "ipversion":
                return 4;
            case "src.addr":
                return "10.244.0.11";
            case "dst.addr":
                return "52.191.16.54";
            case "src.port":
                return "55555";
            case "dst.port":
                return "443";
            case "sent":
                return ~~(Math.random() * 1000);
            case "received":
                return ~~(Math.random() * 1000);
            case "type":
                return "normal";
            case "message":
                return undefined; // Set when type is in (ERR, WARN, DEBUG, INFO)
            case "operation":
                return operations[~~(Math.random() * operations.length)];
            case "netnsid":
                return ~~(Math.random() * 1000000000) + 4000000000;
            case "protocol":
                return protocols[~~(Math.random() * protocols.length)];
            case "status":
                return socketStatuses[~~(Math.random() * socketStatuses.length)];
            case "inodeNumber":
                return ~~(Math.random() * 65535);
            case "reads":
                return ~~(Math.random() * 100);
            case "writes":
                return ~~(Math.random() * 10);
            case "rbytes":
                return ~~(Math.random() * 10000);
            case "wbytes":
                return ~~(Math.random() * 1000);
            case "fileType":
                return 'R'.charCodeAt(0);
            case "filename":
                return "file.txt";
            case "write":
                return !~~(Math.random() * 2);
            case "major":
                return ~~(Math.random() * 10);
            case "minor":
                return undefined;
            case "bytes":
                return ~~(Math.random() * 1000);
            case "us":
                return ~~(Math.random() * 1000);
            case "ops":
                return ~~(Math.random() * 100);
            case "currentRuntime":
                return ~~(Math.random() * 1000);
            case "currentRunCount":
                return ~~(Math.random() * 10);
            case "cumulRuntime":
                return ~~(Math.random() * 10000);
            case "cumulRunCount":
                return ~~(Math.random() * 100);
            case "totalRuntime":
                return ~~(Math.random() * 20000);
            case "totalRunCount":
                return ~~(Math.random() * 200);
            case "mapMemory":
                return ~~(Math.random() * 10000);
            case "mapCount":
                return ~~(Math.random() * 10);
            case "totalCpuUsage":
                return ~~(Math.random() * 100) * 0.0001;
            case "perCpuUsage":
                return ~~(Math.random() * 100) * 0.0001;
            case "kernelStack":
                return `["hrtimer_active", "do_nanosleep", "hrtimer_nanosleep", "__x64_sys_nanosleep", "do_syscall_64", "entry_SYSCALL_64_after_hwframe"]`;
            case "userStack":
                return `["[unknown]", "[unknown]", "[unknown]", "[unknown]", "[unknown]", "[unknown]", "[unknown]"]`;
            case "count":
                return ~~(Math.random() * 5);
            case "timestamp":
                return new Date().getTime() * 1000000 + ~~(Math.random() * 1000000); // fake nanosecond resolution
            case "id":
                return Array.from({length: 4}, _ => ~~(Math.random() * 16)).map(byte => (byte & 0xff).toString(16)).join(''); // Random 4-character hex string
            case "qr":
                return qrValues[~~(Math.random() * qrValues.length)];
            case "nameserver":
                return "168.61.144.22";
            case "pktType":
                return packetTypes[~~(Math.random() * packetTypes.length)];
            case "qtype":
                return queryTypes[~~(Math.random() * queryTypes.length)];
            case "name":
                return "some.domain.com";
            case "rcode":
                return "NoError";
            case "numAnswers":
                return 1;
            case "addresses":
                return `["20.40.70.210"]`;
            case "ret":
                return 0;
            case "args":
                return `["-arg", "14"]`;
            case "cwd":
                return "/path/to/cwd";
            default:
                return `${columnKey}?`;
        }
    }

    const initialState: InitialState = {};

    return [
        Scenario.create("gadget", "", () => <InspektorGadget {...initialState} />, getMessageHandler, stateUpdater.vscodeMessageHandler)
    ];
}
