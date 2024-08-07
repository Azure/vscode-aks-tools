import {
    networkEndpointKeys,
    networkEndpointKeyMetadata,
    derivedNetworkEndpointKeys,
    k8sKeys,
    k8sKeyMetadata,
    derivedNetworkEndpointProperties,
    mountNsKeys,
    mountNsKeyMetadata,
    commandKeys,
    commandKeyMetadata,
} from "./common";
import {
    GadgetExtraProperties,
    GadgetMetadata,
    ItemMetadata,
    ItemProperty,
    SortDirection,
    ValueType,
    getDerivedProperty,
    getLiteralProperties,
    getSortSpecifiers,
    toProperties,
} from "./types";

// Blocking IO
type BlockIOTopKey = 
  | typeof k8sKeys[number]
  | typeof mountNsKeys[number]
  | "pid"
  | typeof commandKeys[number]
  | "write"
  | "major"
  | "minor"
  | "bytes"
  | "us"
  | "ops";

const blockIOTopKeyMetadata: ItemMetadata<BlockIOTopKey> = {
    ...k8sKeyMetadata,
    ...mountNsKeyMetadata,
    pid: { identifier: "pid", name: "PID" },
    ...commandKeyMetadata,
    write: { identifier: "r/w", name: "R/W" },
    major: { identifier: "major", name: "Major" },
    minor: { identifier: "minor", name: "Minor" },
    bytes: { identifier: "bytes", name: "Bytes" },
    us: { identifier: "time", name: "Time" },
    ops: { identifier: "ops", name: "Ops" },
};
const allBlockIOTopProperties: ItemProperty<BlockIOTopKey>[] = [...getLiteralProperties(blockIOTopKeyMetadata)];
const defaultBlockIOTopProperties: ItemProperty<BlockIOTopKey>[] = toProperties(allBlockIOTopProperties, [
    "k8s.node",
    "k8s.namespace",
    "k8s.podName",
    "k8s.containerName",
    "pid",
    "comm",
    "write",
    "major",
    "minor",
    "bytes",
    "us",
    "ops",
]);
const defaultBlockIOTopSort = getSortSpecifiers(allBlockIOTopProperties, [
    { key: "ops", direction: SortDirection.Descending },
    { key: "bytes", direction: SortDirection.Descending },
    { key: "us", direction: SortDirection.Descending },
]);
export const blockIOTopMetadata: GadgetMetadata<BlockIOTopKey> = {
    name: "Top Block IO",
    allProperties: allBlockIOTopProperties,
    defaultProperties: defaultBlockIOTopProperties,
    defaultSort: defaultBlockIOTopSort,
    extraProperties: GadgetExtraProperties.SortingAllowed | GadgetExtraProperties.RequiresMaxItemCount,
};

// eBPF
type EbpfTopKey = 
  | typeof k8sKeys[number]
  | "progid"
  | "type"
  | "name"
  | "processes.pid"
  | "processes.comm"
  | "currentRuntime"
  | "currentRunCount"
  | "cumulRuntime"
  | "cumulRunCount"
  | "totalRuntime"
  | "totalRunCount"
  | "mapMemory"
  | "mapCount"
  | "totalCpuUsage"
  | "perCpuUsage";

const ebpfTopKeyMetadata: ItemMetadata<EbpfTopKey> = {
    ...k8sKeyMetadata,
    progid: { identifier: "progid", name: "Program ID" },
    type: { identifier: "type", name: "Type" },
    name: { identifier: "name", name: "Name" },
    "processes.pid": { identifier: "pid", name: "PID" },
    "processes.comm": { identifier: "comm", name: "Command" },
    currentRuntime: { identifier: "runtime", name: "Runtime" },
    currentRunCount: { identifier: "runcount", name: "Run Count" },
    cumulRuntime: { identifier: "cumulruntime", name: "Cumulative Runtime" },
    cumulRunCount: { identifier: "cumulruncount", name: "Cumulative Run Count" },
    totalRuntime: { identifier: "totalruntime", name: "Total Runtime" },
    totalRunCount: { identifier: "totalRunCount", name: "Total Run Count" },
    mapMemory: { identifier: "mapmemory", name: "Map Memory" },
    mapCount: { identifier: "mapcount", name: "Map Count" },
    totalCpuUsage: { identifier: "totalcpu", name: "Total CPU Usage" },
    perCpuUsage: { identifier: "percpu", name: "Per CPU Usage" },
};
const allEbpfTopProperties: ItemProperty<EbpfTopKey>[] = [...getLiteralProperties(ebpfTopKeyMetadata)];
const defaultEbpfTopProperties: ItemProperty<EbpfTopKey>[] = toProperties(allEbpfTopProperties, [
    "k8s.node",
    "progid",
    "type",
    "name",
    "processes.pid",
    "processes.comm",
    "currentRuntime",
    "currentRunCount",
    "mapMemory",
    "mapCount",
]);
const defaultEbpfTopSort = getSortSpecifiers(allEbpfTopProperties, [
    { key: "currentRuntime", direction: SortDirection.Descending },
    { key: "currentRunCount", direction: SortDirection.Descending },
]);
export const ebpfTopMetadata: GadgetMetadata<EbpfTopKey> = {
    name: "Top eBPF",
    allProperties: allEbpfTopProperties,
    defaultProperties: defaultEbpfTopProperties,
    defaultSort: defaultEbpfTopSort,
    extraProperties:
        GadgetExtraProperties.SortingAllowed |
        GadgetExtraProperties.RequiresMaxItemCount |
        GadgetExtraProperties.NoK8sResourceFiltering,
};

// File
type FileTopKey = 
  | typeof k8sKeys[number]
  | typeof mountNsKeys[number]
  | "pid"
  | typeof commandKeys[number]
  | "reads"
  | "rbytes"
  | "fileType"
  | "filename"
  | "wbytes"
  | "writes";

const fileTopKeyMetadata: ItemMetadata<FileTopKey> = {
    ...k8sKeyMetadata,
    ...mountNsKeyMetadata,
    pid: { identifier: "pid", name: "PID" },
    ...commandKeyMetadata,
    reads: { identifier: "reads", name: "Reads" },
    rbytes: { identifier: "rbytes", name: "RBytes" },
    fileType: { identifier: "t", name: "T", valueType: ValueType.CharByte },
    filename: { identifier: "file", name: "File" },
    wbytes: { identifier: "wbytes", name: "WBytes" },
    writes: { identifier: "writes", name: "Writes" },
};
const allFileTopProperties: ItemProperty<FileTopKey>[] = [...getLiteralProperties(fileTopKeyMetadata)];
const defaultFileTopProperties: ItemProperty<FileTopKey>[] = toProperties(allFileTopProperties, [
    "k8s.node",
    "k8s.namespace",
    "k8s.podName",
    "k8s.containerName",
    "pid",
    "comm",
    "reads",
    "writes",
    "rbytes",
    "wbytes",
    "fileType",
    "filename",
]);
const defaultFileTopSort = getSortSpecifiers(allFileTopProperties, [
    { key: "reads", direction: SortDirection.Descending },
    { key: "writes", direction: SortDirection.Descending },
    { key: "rbytes", direction: SortDirection.Descending },
    { key: "wbytes", direction: SortDirection.Descending },
]);
export const fileTopMetadata: GadgetMetadata<FileTopKey> = {
    name: "Top File",
    allProperties: allFileTopProperties,
    defaultProperties: defaultFileTopProperties,
    defaultSort: defaultFileTopSort,
    extraProperties: GadgetExtraProperties.SortingAllowed | GadgetExtraProperties.RequiresMaxItemCount,
};

// TCP
type TcpTopKey = 
  | typeof k8sKeys[number]
  | typeof mountNsKeys[number]
  | "pid"
  | typeof commandKeys[number]
  | "family"
  | typeof networkEndpointKeys[number]
  | "sent"
  | "received";

const tcpTopKeyMetadata: ItemMetadata<TcpTopKey> = {
    ...k8sKeyMetadata,
    ...mountNsKeyMetadata,
    pid: { identifier: "pid", name: "PID" },
    ...commandKeyMetadata,
    family: { identifier: "ip", name: "IP" },
    ...networkEndpointKeyMetadata,
    sent: { identifier: "sent", name: "Sent", valueType: ValueType.Bytes },
    received: { identifier: "recv", name: "Recv", valueType: ValueType.Bytes },
};
type DerivedTcpTopKey = 
  | "ip"
  | typeof derivedNetworkEndpointKeys[number];

const allTcpTopProperties: ItemProperty<TcpTopKey | DerivedTcpTopKey>[] = [
    ...getLiteralProperties(tcpTopKeyMetadata),
    // https://github.com/inspektor-gadget/inspektor-gadget/blob/08056695b8cfc02698afcbd41add88acfac4d8cf/pkg/gadgets/top/tcp/types/types.go#L64-L69
    getDerivedProperty("IP", "ip", (item) => (item.family === 2 ? 4 : 6)),
    ...derivedNetworkEndpointProperties,
];
const defaultTcpTopProperties: ItemProperty<TcpTopKey | DerivedTcpTopKey>[] = toProperties(allTcpTopProperties, [
    "k8s.node",
    "k8s.namespace",
    "k8s.podName",
    "k8s.containerName",
    "pid",
    "comm",
    "ip",
    "src",
    "dst",
    "sent",
    "received",
]);
const defaultTcpTopSort = getSortSpecifiers(allTcpTopProperties, [
    { key: "sent", direction: SortDirection.Descending },
    { key: "received", direction: SortDirection.Descending },
]);
export const tcpTopMetadata: GadgetMetadata<TcpTopKey | DerivedTcpTopKey> = {
    name: "Top TCP",
    allProperties: allTcpTopProperties,
    defaultProperties: defaultTcpTopProperties,
    defaultSort: defaultTcpTopSort,
    extraProperties: GadgetExtraProperties.SortingAllowed | GadgetExtraProperties.RequiresMaxItemCount,
};
