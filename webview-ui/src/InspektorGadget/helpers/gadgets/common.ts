import { ItemMetadata, ItemProperty, ValueType, getDerivedProperty } from "./types";

// Common K8s properties
export const k8sKeys = ["k8s.node", "k8s.namespace", "k8s.podName", "k8s.containerName"] as const;
export type K8sKey = (typeof k8sKeys)[number];
export const k8sKeyMetadata: ItemMetadata<K8sKey> = {
    "k8s.node": { identifier: "node", name: "Node" },
    "k8s.namespace": { identifier: "namespace", name: "Namespace" },
    "k8s.podName": { identifier: "pod", name: "Pod" },
    "k8s.containerName": { identifier: "container", name: "Container" },
};

// Commands
export const commandKeys = ["comm"] as const;
export type CommandKey = (typeof commandKeys)[number];
export const commandKeyMetadata: ItemMetadata<CommandKey> = {
    comm: { identifier: "comm", name: "Command" },
};

// Events
export const eventKeys = ["type", "message"] as const;
export type EventKey = (typeof eventKeys)[number];
export const eventKeyMetadata: ItemMetadata<EventKey> = {
    type: { identifier: "type", name: "Type" },
    message: { identifier: "message", name: "Message" },
};

// Mount namespace
export const mountNsKeys = ["mountnsid"] as const;
export type MountNsKey = (typeof mountNsKeys)[number];
export const mountNsKeyMetadata: ItemMetadata<MountNsKey> = {
    mountnsid: { identifier: "mntns", name: "MountNsID" },
};

// Network endpoints
export const networkEndpointKeys = ["src.addr", "src.port", "dst.addr", "dst.port"] as const;
export type NetworkEndpointKey = (typeof networkEndpointKeys)[number];
export const networkEndpointKeyMetadata: ItemMetadata<NetworkEndpointKey> = {
    "src.addr": { identifier: "src.addr", name: "SrcAddr" },
    "src.port": { identifier: "src.port", name: "SrcPort" },
    "dst.addr": { identifier: "dst.addr", name: "DstAddr" },
    "dst.port": { identifier: "dst.port", name: "DstPort" },
};

export const derivedNetworkEndpointKeys = ["src", "dst"] as const;
export type DerivedNetworkEndpointKey = (typeof derivedNetworkEndpointKeys)[number];
export const derivedNetworkEndpointProperties: ItemProperty<NetworkEndpointKey | DerivedNetworkEndpointKey>[] = [
    getDerivedProperty("Src", "src", (item) => `${item["src.addr"]}:${item["src.port"]}`),
    getDerivedProperty("Dst", "dst", (item) => `${item["dst.addr"]}:${item["dst.port"]}`),
];

// Processes/threads
export const processThreadKeys = ["pid", "tid"] as const;
export type ProcessThreadKey = (typeof processThreadKeys)[number];
export const processThreadKeyMetadata: ItemMetadata<ProcessThreadKey> = {
    pid: { identifier: "pid", name: "PID" },
    tid: { identifier: "tid", name: "TID" },
};

// Timestamp
export const timestampKeys = ["timestamp"] as const;
export type TimestampKey = (typeof timestampKeys)[number];
export const timestampKeyMetadata: ItemMetadata<TimestampKey> = {
    timestamp: { identifier: "timestamp", name: "Timestamp", valueType: ValueType.Timestamp },
};

// User/group IDs
export const userKeys = ["uid", "gid"] as const;
export type UserKey = (typeof userKeys)[number];
export const userKeyMetadata: ItemMetadata<UserKey> = {
    uid: { identifier: "uid", name: "UID" },
    gid: { identifier: "gid", name: "GID" },
};
