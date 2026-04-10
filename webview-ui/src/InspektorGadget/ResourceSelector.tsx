import { FormEvent, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import styles from "./InspektorGadget.module.css";
import { NamespaceResources } from "./helpers/clusterResources";
import { isLoaded, isNotLoaded } from "../utilities/lazy";
import { EventHandlers } from "../utilities/state";
import { EventDef, vscode } from "./helpers/state";
import { ProgressRing } from "../components/ProgressRing";

type ChangeEvent = Event | FormEvent<HTMLElement>;

const resourceProperties = { namespace: "namespace", podName: "podName", containerName: "containerName" } as const;
type SelectedNamespace = { [resourceProperties.namespace]: string };
type SelectedPod = SelectedNamespace & { [resourceProperties.podName]: string };
type SelectedContainer = SelectedPod & { [resourceProperties.containerName]: string };

type SelectedResource = Record<string, never> | SelectedNamespace | SelectedPod | SelectedContainer;

function isNoResource(selectedResource: SelectedResource): selectedResource is Record<string, never> {
    return !(resourceProperties.namespace in selectedResource);
}

function isNamespaceResource(selectedResource: SelectedResource): selectedResource is SelectedNamespace {
    return (
        resourceProperties.namespace in selectedResource &&
        !(resourceProperties.podName in selectedResource) &&
        !(resourceProperties.containerName in selectedResource)
    );
}

function isPodResource(selectedResource: SelectedResource): selectedResource is SelectedPod {
    return resourceProperties.podName in selectedResource && !(resourceProperties.containerName in selectedResource);
}

function isContainerResource(selectedResource: SelectedResource): selectedResource is SelectedContainer {
    return resourceProperties.containerName in selectedResource;
}

export interface ResourceSelectorProps {
    id?: string;
    className?: string;
    resources: NamespaceResources[];
    onSelectionChanged: (selection: { namespace?: string; podName?: string; containerName?: string }) => void;
    userMessageHandlers: EventHandlers<EventDef>;
}

// Expansion state to track which namespaces and pods are expanded.
type ExpandedState = {
    namespaces: Record<string, boolean>;
    pods: Record<string, boolean>; // keyed as "namespace/podName"
};

export function ResourceSelector(props: ResourceSelectorProps) {
    const [expanded, setExpanded] = useState<ExpandedState>({ namespaces: {}, pods: {} });
    const [selectedResource, setSelectedResource] = useState<SelectedResource>({});

    function isNamespaceExpanded(ns: string): boolean {
        return !!expanded.namespaces[ns];
    }

    // Pods are keyed as "namespace/podName"
    function isPodExpanded(ns: string, pod: string): boolean {
        return !!expanded.pods[`${ns}/${pod}`];
    }

    function toggleNamespaceExpanded(namespace: string) {
        const wasExpanded = isNamespaceExpanded(namespace);
        setExpanded((prev) => ({
            ...prev,
            namespaces: { ...prev.namespaces, [namespace]: !wasExpanded },
        }));

        if (!wasExpanded) {
            const nsResource = props.resources.find((ns) => ns.name === namespace);
            if (nsResource && isNotLoaded(nsResource.children)) {
                props.userMessageHandlers.onSetPodsLoading({ namespace });
                vscode.postGetPodsRequest({ namespace });
            }
        }
    }

    function togglePodExpanded(namespace: string, podName: string) {
        const key = `${namespace}/${podName}`;
        const wasExpanded = isPodExpanded(namespace, podName);
        setExpanded((prev) => ({
            ...prev,
            pods: { ...prev.pods, [key]: !wasExpanded },
        }));

        if (!wasExpanded) {
            const nsResource = props.resources.find((ns) => ns.name === namespace);
            if (nsResource && isLoaded(nsResource.children)) {
                const podResource = nsResource.children.value.find((p) => p.name === podName);
                if (podResource && isNotLoaded(podResource.children)) {
                    props.userMessageHandlers.onSetContainersLoading({ namespace, podName });
                    vscode.postGetContainersRequest({ namespace, podName });
                }
            }
        }
    }

    function handleNoResourceChange(e: ChangeEvent) {
        if ((e.target as HTMLInputElement).checked) {
            setSelectedResource({});
            props.onSelectionChanged({});
        }
    }

    function handleNamespaceChange(e: ChangeEvent, namespace: string) {
        if ((e.target as HTMLInputElement).checked) {
            setSelectedResource({ namespace });
            props.onSelectionChanged({ namespace });
        }
    }

    function handlePodChange(e: ChangeEvent, namespace: string, podName: string) {
        if ((e.target as HTMLInputElement).checked) {
            setSelectedResource({ namespace, podName });
            props.onSelectionChanged({ namespace, podName });
        }
    }

    function handleContainerChange(e: ChangeEvent, namespace: string, podName: string, containerName: string) {
        if ((e.target as HTMLInputElement).checked) {
            setSelectedResource({ namespace, podName, containerName });
            props.onSelectionChanged({ namespace, podName, containerName });
        }
    }

    return (
        <ul
            id={props.id}
            className={props.className ? `${props.className} ${styles.hierarchyList}` : styles.hierarchyList}
        >
            <li>
                <div className={styles.radioLine}>
                    <input
                        type="radio"
                        onChange={handleNoResourceChange}
                        checked={isNoResource(selectedResource)}
                    ></input>
                    <label className={styles.radioLabel}>All</label>
                </div>
            </li>
            {props.resources.map((nsItem) => (
                <li key={nsItem.name}>
                    <FontAwesomeIcon
                        className={styles.expander}
                        onClick={() => toggleNamespaceExpanded(nsItem.name)}
                        icon={isNamespaceExpanded(nsItem.name) ? faChevronDown : faChevronRight}
                    />
                    <div className={styles.radioLine}>
                        <input
                            type="radio"
                            className={styles.selector}
                            onChange={(e) => handleNamespaceChange(e, nsItem.name)}
                            checked={
                                isNamespaceResource(selectedResource) && selectedResource.namespace === nsItem.name
                            }
                        ></input>
                        <label className={styles.radioLabel}>{nsItem.name}</label>
                    </div>
                    {isNamespaceExpanded(nsItem.name) && (
                        <ul className={styles.hierarchyList}>
                            {isLoaded(nsItem.children) ? (
                                nsItem.children.value.length === 0 ? (
                                    <li>
                                        <label className={styles.radioLabel}>
                                            <i>No pods</i>
                                        </label>
                                    </li>
                                ) : (
                                    nsItem.children.value.map((podItem) => (
                                        <li key={podItem.name}>
                                            <FontAwesomeIcon
                                                className={styles.expander}
                                                onClick={() => togglePodExpanded(nsItem.name, podItem.name)}
                                                icon={
                                                    isPodExpanded(nsItem.name, podItem.name)
                                                        ? faChevronDown
                                                        : faChevronRight
                                                }
                                            />
                                            <div className={styles.radioLine}>
                                                <input
                                                    type="radio"
                                                    onChange={(e) => handlePodChange(e, nsItem.name, podItem.name)}
                                                    checked={
                                                        isPodResource(selectedResource) &&
                                                        selectedResource.namespace === nsItem.name &&
                                                        selectedResource.podName === podItem.name
                                                    }
                                                ></input>
                                                <label className={styles.radioLabel}>{podItem.name}</label>
                                            </div>
                                            {isPodExpanded(nsItem.name, podItem.name) && (
                                                <ul className={styles.hierarchyList}>
                                                    {isLoaded(podItem.children) ? (
                                                        podItem.children.value.length === 0 ? (
                                                            <li>
                                                                <label className={styles.radioLabel}>
                                                                    <i>No containers</i>
                                                                </label>
                                                            </li>
                                                        ) : (
                                                            podItem.children.value.map((containerName) => (
                                                                <li key={containerName}>
                                                                    <div className={styles.radioLine}>
                                                                        <input
                                                                            type="radio"
                                                                            onChange={(e) =>
                                                                                handleContainerChange(
                                                                                    e,
                                                                                    nsItem.name,
                                                                                    podItem.name,
                                                                                    containerName,
                                                                                )
                                                                            }
                                                                            checked={
                                                                                isContainerResource(selectedResource) &&
                                                                                selectedResource.namespace ===
                                                                                    nsItem.name &&
                                                                                selectedResource.podName ===
                                                                                    podItem.name &&
                                                                                selectedResource.containerName ===
                                                                                    containerName
                                                                            }
                                                                        ></input>
                                                                        <label className={styles.radioLabel}>
                                                                            {containerName}
                                                                        </label>
                                                                    </div>
                                                                </li>
                                                            ))
                                                        )
                                                    ) : (
                                                        <ProgressRing />
                                                    )}
                                                </ul>
                                            )}
                                        </li>
                                    ))
                                )
                            ) : (
                                <ProgressRing />
                            )}
                        </ul>
                    )}
                </li>
            ))}
        </ul>
    );
}
