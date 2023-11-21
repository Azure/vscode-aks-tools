import { derivedNetworkEndpointKeys, networkEndpointKeys, networkEndpointKeyMetadata, k8sKeys, k8sKeyMetadata, derivedNetworkEndpointProperties, timestampKeys, mountNsKeys, mountNsKeyMetadata, processThreadKeys, timestampKeyMetadata, processThreadKeyMetadata, commandKeys, commandKeyMetadata, userKeyMetadata, userKeys } from "./common";
import { GadgetExtraProperties, GadgetMetadata, getDerivedProperty, getLiteralProperties, ItemMetadata, ItemProperty, toProperties, ValueType } from "./types";

// DNS
const dnsTraceKeys = [...k8sKeys, ...timestampKeys, ...mountNsKeys, "netnsid", ...processThreadKeys, ...commandKeys, ...userKeys, "id", "qr", "nameserver", "pktType", "qtype", "name", "rcode", "numAnswers", "addresses"] as const;
type DnsTraceKey = typeof dnsTraceKeys[number];
const dnsTraceKeyMetadata: ItemMetadata<DnsTraceKey> = {
    ...k8sKeyMetadata,
    ...timestampKeyMetadata,
    ...mountNsKeyMetadata,
    netnsid: { identifier: "netns", name: "NetNS" },
    ...processThreadKeyMetadata,
    ...commandKeyMetadata,
    ...userKeyMetadata,
    id: { identifier: "id", name: "ID" },
    qr: { identifier: "qr", name: "QR" },
    nameserver: { identifier: "nameserver", name: "Nameserver" },
    pktType: { identifier: "type", name: "Type" },
    qtype: { identifier: "qtype", name: "QType" },
    name: { identifier: "name", name: "Name" },
    rcode: { identifier: "rcode", name: "RCode" },
    numAnswers: { identifier: "numAnswers", name: "#Answers" },
    addresses: { identifier: "addresses", name: "Addresses", valueType: ValueType.AddressArray }
};
const allDnsTraceProperties: ItemProperty<DnsTraceKey>[] = [
    ...getLiteralProperties(dnsTraceKeyMetadata)
];
const defaultDnsTraceProperties: ItemProperty<DnsTraceKey>[] = toProperties(
    allDnsTraceProperties,
    ["k8s.node","k8s.namespace","k8s.podName","pid","tid","comm","qr","pktType","qtype","name","rcode","numAnswers"]
);
export const dnsTraceMetadata: GadgetMetadata<DnsTraceKey> = {
    name: "Trace DNS",
    allProperties: allDnsTraceProperties,
    defaultProperties: defaultDnsTraceProperties,
    defaultSort: null,
    extraProperties: GadgetExtraProperties.None
}

// Exec
const execTraceKeys = [...k8sKeys, ...timestampKeys, ...mountNsKeys, "pid", "ppid", ...commandKeys, "ret", "args", ...userKeys, "loginuid", "sessionid", "cwd"] as const;
type ExecTraceKey = typeof execTraceKeys[number];
const execTraceKeyMetadata: ItemMetadata<ExecTraceKey> = {
    ...k8sKeyMetadata,
    ...timestampKeyMetadata,
    ...mountNsKeyMetadata,
    pid: { identifier: "pid", name: "PID" },
    ppid: { identifier: "ppid", name: "PPID" },
    ...commandKeyMetadata,
    ret: { identifier: "ret", name: "Return" },
    args: { identifier: "args", name: "Args" },
    ...userKeyMetadata,
    loginuid: { identifier: "loginuid", name: "LoginUID" },
    sessionid: { identifier: "sessionid", name: "SessionID" },
    cwd: { identifier: "cwd", name: "CWD" }
}
const allExecTraceProperties: ItemProperty<ExecTraceKey>[] = [
    ...getLiteralProperties(execTraceKeyMetadata)
];
const defaultExecTraceProperties: ItemProperty<ExecTraceKey>[] = toProperties(
    allExecTraceProperties,
    ["k8s.node","k8s.namespace","k8s.podName","k8s.containerName","pid","ppid","comm","ret","args"]
);
export const execTraceMetadata: GadgetMetadata<ExecTraceKey> = {
    name: "Trace Exec",
    allProperties: allExecTraceProperties,
    defaultProperties: defaultExecTraceProperties,
    defaultSort: null,
    extraProperties: GadgetExtraProperties.None
};

// TCP
const tcpTraceKeys = [...k8sKeys, "operation", "pid", ...commandKeys, "ipversion", ...networkEndpointKeys, ...mountNsKeys] as const;
type TcpTraceKey = typeof tcpTraceKeys[number];
const tcpTraceKeyMetadata: ItemMetadata<TcpTraceKey> = {
    ...k8sKeyMetadata,
    operation: { identifier: "t", name: "T" },
    pid: { identifier: "pid", name: "PID" },
    ...commandKeyMetadata,
    ipversion: { identifier: "ip", name: "IP" },
    ...networkEndpointKeyMetadata,
    ...mountNsKeyMetadata
};
const derivedTcpTraceKeys = ["t", ...derivedNetworkEndpointKeys] as const;
type DerivedTcpTraceKey = typeof derivedTcpTraceKeys[number];
const allTcpTraceProperties: ItemProperty<TcpTraceKey | DerivedTcpTraceKey>[] = [
    ...getLiteralProperties(tcpTraceKeyMetadata),
    ...derivedNetworkEndpointProperties,
    getDerivedProperty("T", "t", item => tcpOperationDisplay[item.operation as string] || "U")
];
const defaultTcpTraceProperties: ItemProperty<TcpTraceKey | DerivedTcpTraceKey>[] = toProperties(
    allTcpTraceProperties,
    ["k8s.node","k8s.namespace","k8s.podName","k8s.containerName","t","pid","comm","ipversion","src","dst"]
);
export const tcpTraceMetadata: GadgetMetadata<TcpTraceKey | DerivedTcpTraceKey> = {
    name: "Trace TCP",
    allProperties: allTcpTraceProperties,
    defaultProperties: defaultTcpTraceProperties,
    defaultSort: null,
    extraProperties: GadgetExtraProperties.None
}

// https://github.com/inspektor-gadget/inspektor-gadget/blob/08056695b8cfc02698afcbd41add88acfac4d8cf/pkg/gadgets/trace/tcp/types/types.go#LL40C1-L45C4
const tcpOperationDisplay: {[op: string]: string} = {
    accept: "A",
    connect: "C",
    close: "X",
    unknown: "U"
};
