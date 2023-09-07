import { commandKeyMetadata, commandKeys, k8sKeyMetadata, k8sKeys } from "./common";
import { GadgetExtraProperties, GadgetMetadata, ItemMetadata, ItemProperty, ValueType, getDerivedProperty, getLiteralProperties, toProperties } from "./types";

// CPU
const cpuProfileKeys = [...k8sKeys, ...commandKeys, "pid", "userStack", "kernelStack", "count"] as const;
type CpuProfileKey = typeof cpuProfileKeys[number];
const cpuProfileKeyMetadata: ItemMetadata<CpuProfileKey> = {
    ...k8sKeyMetadata,
    ...commandKeyMetadata,
    pid: { identifier: "pid", name: "PID" },
    userStack: { identifier: "userStack", name: "User Stack" },
    kernelStack: { identifier: "kernelStack", name: "Kernel Stack" },
    count: { identifier: "gid", name: "GID" }
};
const derivedCpuProfileKeys = ["stack"] as const;
type DerivedCpuProfileKey = typeof derivedCpuProfileKeys[number];
const allCpuProfileProperties: ItemProperty<CpuProfileKey | DerivedCpuProfileKey>[] = [
    ...getLiteralProperties(cpuProfileKeyMetadata),
    getDerivedProperty("Stack", "stack", item => {
        const kernelStack = item.kernelStack ? JSON.parse(item.kernelStack) : [];
        const userStack = item.userStack ? JSON.parse(item.userStack) : [];
        return [...kernelStack, ...userStack].join('\n');
    }, ValueType.StackTrace)
];
const defaultCpuProfileProperties: ItemProperty<CpuProfileKey | DerivedCpuProfileKey>[] = toProperties(
    allCpuProfileProperties,
    ["k8s.node","k8s.namespace","k8s.podName","k8s.containerName","comm","pid","count", "stack"]
);
export const cpuProfileMetadata: GadgetMetadata<CpuProfileKey | DerivedCpuProfileKey> = {
    name: "CPU",
    allProperties: allCpuProfileProperties,
    defaultProperties: defaultCpuProfileProperties,
    defaultSort: null,
    extraProperties: GadgetExtraProperties.RequiresTimeout
};
