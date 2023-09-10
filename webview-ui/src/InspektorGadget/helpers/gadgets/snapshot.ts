import { eventKeyMetadata, processThreadKeyMetadata, processThreadKeys, networkEndpointKeys, networkEndpointKeyMetadata, derivedNetworkEndpointKeys, k8sKeys, eventKeys, k8sKeyMetadata, derivedNetworkEndpointProperties, mountNsKeyMetadata, mountNsKeys, commandKeys, commandKeyMetadata, userKeys, userKeyMetadata } from "./common";
import { GadgetExtraProperties, GadgetMetadata, ItemMetadata, ItemProperty, SortDirection, getLiteralProperties, getSortSpecifiers, toProperties } from "./types";

// Process
const processSnapshotKeys = [...k8sKeys, ...eventKeys, ...commandKeys, ...processThreadKeys, ...userKeys, "ppid", ...mountNsKeys] as const;
export type ProcessSnapshotKey = typeof processSnapshotKeys[number];
const processSnapshotKeyMetadata: ItemMetadata<ProcessSnapshotKey> = {
    ...k8sKeyMetadata,
    ...eventKeyMetadata,
    ...commandKeyMetadata,
    ...processThreadKeyMetadata,
    ...userKeyMetadata,
    ppid: { identifier: "ppid", name: "PPID" },
    ...mountNsKeyMetadata
};
const allProcessSnapshotProperties: ItemProperty<ProcessSnapshotKey>[] = [
    ...getLiteralProperties(processSnapshotKeyMetadata)
];
const defaultProcessSnapshotProperties: ItemProperty<ProcessSnapshotKey>[] = toProperties(
    allProcessSnapshotProperties,
    ["k8s.node","k8s.namespace","k8s.podName","k8s.containerName","comm","pid","tid","uid","gid"]
);
const defaultProcessSnapshotSort = getSortSpecifiers(allProcessSnapshotProperties, [
    {key: "k8s.node", direction: SortDirection.Ascending},
    {key: "k8s.namespace", direction: SortDirection.Ascending},
    {key: "k8s.podName", direction: SortDirection.Ascending},
    {key: "k8s.containerName", direction: SortDirection.Ascending},
    {key: "comm", direction: SortDirection.Ascending},
    {key: "pid", direction: SortDirection.Ascending},
    {key: "tid", direction: SortDirection.Ascending},
    {key: "ppid", direction: SortDirection.Ascending}
]);
export const processSnapshotMetadata: GadgetMetadata<ProcessSnapshotKey> = {
    name: "Processes",
    allProperties: allProcessSnapshotProperties,
    defaultProperties: defaultProcessSnapshotProperties,
    defaultSort: defaultProcessSnapshotSort,
    extraProperties: GadgetExtraProperties.SortingAllowed | GadgetExtraProperties.ThreadExclusionAllowed
};

// Socket
const socketSnapshotKeys = [...k8sKeys, ...eventKeys, "netnsid", "protocol", ...networkEndpointKeys, "status", "inodeNumber"] as const;
type SocketSnapshotKey = typeof socketSnapshotKeys[number];
const socketSnapshotKeyMetadata: ItemMetadata<SocketSnapshotKey> = {
    ...k8sKeyMetadata,
    ...eventKeyMetadata,
    netnsid: { identifier: "netns", name: "NetNS" },
    protocol: { identifier: "protocol", name: "Protocol" },
    ...networkEndpointKeyMetadata,
    status: { identifier: "status", name: "Status" },
    inodeNumber: { identifier: "inode", name: "Inode" }
};
const derivedSocketSnapshotKeys = [...derivedNetworkEndpointKeys] as const;
type DerivedSocketSnapshotKey = typeof derivedSocketSnapshotKeys[number];
const allSocketSnapshotProperties: ItemProperty<SocketSnapshotKey | DerivedSocketSnapshotKey>[] = [
    ...getLiteralProperties(socketSnapshotKeyMetadata),
    ...derivedNetworkEndpointProperties
];
const defaultSocketSnapshotProperties: ItemProperty<SocketSnapshotKey | DerivedSocketSnapshotKey>[] = toProperties(
    allSocketSnapshotProperties,
    ["k8s.node","k8s.namespace","k8s.podName","protocol","src","dst","status"]
);
const defaultSocketSnapshotSort = getSortSpecifiers(allSocketSnapshotProperties, [
    {key: "k8s.node", direction: SortDirection.Ascending},
    {key: "k8s.namespace", direction: SortDirection.Ascending},
    {key: "k8s.podName", direction: SortDirection.Ascending},
    {key: "protocol", direction: SortDirection.Ascending},
    {key: "status", direction: SortDirection.Ascending},
    {key: "src", direction: SortDirection.Ascending},
    {key: "dst", direction: SortDirection.Ascending},
    {key: "inodeNumber", direction: SortDirection.Ascending}
]);
export const socketSnapshotMetadata: GadgetMetadata<SocketSnapshotKey | DerivedSocketSnapshotKey> = {
    name: "Sockets",
    allProperties: allSocketSnapshotProperties,
    defaultProperties: defaultSocketSnapshotProperties,
    defaultSort: defaultSocketSnapshotSort,
    extraProperties: GadgetExtraProperties.SortingAllowed
};
