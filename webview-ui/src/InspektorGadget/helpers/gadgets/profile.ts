import { commandKeyMetadata, commandKeys, k8sKeyMetadata, k8sKeys } from "./common";
import {
    GadgetExtraProperties,
    GadgetMetadata,
    ItemMetadata,
    ItemProperty,
    ValueType,
    getDerivedProperty,
    getLiteralProperties,
    toProperties,
} from "./types";

// CPU
type CpuProfileKey =
    | (typeof k8sKeys)[number]
    | (typeof commandKeys)[number]
    | "pid"
    | "user_stack"
    | "kern_stack"
    | "samples";
const cpuProfileKeyMetadata: ItemMetadata<CpuProfileKey> = {
    ...k8sKeyMetadata,
    ...commandKeyMetadata,
    pid: { identifier: "pid", name: "PID" },
    user_stack: { identifier: "userStack", name: "User Stack" },
    kern_stack: { identifier: "kernelStack", name: "Kernel Stack" },
    samples: { identifier: "count", name: "Count" },
};
type DerivedCpuProfileKey = "stack";
const allCpuProfileProperties: ItemProperty<CpuProfileKey | DerivedCpuProfileKey>[] = [
    ...getLiteralProperties(cpuProfileKeyMetadata),
    getDerivedProperty(
        "Stack",
        "stack",
        (item) => {
            const kernelStack =
                item.kern_stack && typeof item.kern_stack === "string" ? JSON.parse(item.kern_stack) : [];
            const userStack = item.user_stack && typeof item.user_stack === "string" ? JSON.parse(item.user_stack) : [];
            return [...kernelStack, ...userStack].join("\n");
        },
        ValueType.StackTrace,
    ),
];
const defaultCpuProfileProperties: ItemProperty<CpuProfileKey | DerivedCpuProfileKey>[] = toProperties(
    allCpuProfileProperties,
    ["k8s.node", "k8s.namespace", "k8s.podName", "k8s.containerName", "comm", "pid", "samples", "stack"],
);
export const cpuProfileMetadata: GadgetMetadata<CpuProfileKey | DerivedCpuProfileKey> = {
    name: "CPU",
    allProperties: allCpuProfileProperties,
    defaultProperties: defaultCpuProfileProperties,
    defaultSort: null,
    extraProperties: GadgetExtraProperties.RequiresTimeout,
};
