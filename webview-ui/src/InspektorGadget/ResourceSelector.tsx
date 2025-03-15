import { FormEvent, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import styles from "./InspektorGadget.module.css";
import { NamespaceResources, PodResources } from "./helpers/clusterResources";
import { Lazy, isLoaded, isNotLoaded, map as lazyMap, orDefault } from "../utilities/lazy";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { Lookup, asLookup, exclude, intersection } from "../utilities/array";
import { EventHandlers } from "../utilities/state";
import { EventDef, vscode } from "./helpers/state";

type ChangeEvent = Event | FormEvent<HTMLElement>;

type PodItemStatus = {
    isExpanded: boolean;
};

type AllPodItemStatuses = Lookup<PodItemStatus>;

type NamespaceItemStatus = {
    isExpanded: boolean;
    podStatuses: AllPodItemStatuses;
};

type AllNamespaceItemStatuses = Lookup<NamespaceItemStatus>;

const resourceProperties = { namespace: "namespace", podName: "podName", container: "container" } as const;
type SelectedNamespace = { [resourceProperties.namespace]: string };
type SelectedPod = SelectedNamespace & { [resourceProperties.podName]: string };
type SelectedContainer = SelectedPod & { [resourceProperties.container]: string };

type SelectedResource = Record<string, never> | SelectedNamespace | SelectedPod | SelectedContainer;

function isNoResource(selectedResource: SelectedResource): selectedResource is Record<string, never> {
    return !(resourceProperties.namespace in selectedResource);
}

function isNamespaceResource(selectedResource: SelectedResource): selectedResource is SelectedNamespace {
    return (
        resourceProperties.namespace in selectedResource &&
        !(resourceProperties.podName in selectedResource) &&
        !(resourceProperties.container in selectedResource)
    );
}

function isPodResource(selectedResource: SelectedResource): selectedResource is SelectedPod {
    return resourceProperties.podName in selectedResource && !(resourceProperties.container in selectedResource);
}

function isContainerResource(selectedResource: SelectedResource): selectedResource is SelectedContainer {
    return resourceProperties.container in selectedResource;
}

function lazyAsLookup<T>(lazyList: Lazy<T[]>, keyFn: (value: T) => string): Lookup<T> {
    return orDefault(
        lazyMap(lazyList, (items) => asLookup(items, keyFn)),
        {},
    );
}

function getUpdatedNamespaceItemStatus(status: NamespaceItemStatus, resource: NamespaceResources): NamespaceItemStatus {
    const resources = lazyAsLookup(resource.children, (p) => p.name);
    const pods = Object.keys(resources);
    const podsWithStatus = Object.keys(status.podStatuses);
    const existingStatuses = intersection(pods, podsWithStatus).map((p) => [p, status.podStatuses[p]]);
    const newStatuses = exclude(pods, podsWithStatus).map((p) => [p, { isExpanded: false }]);
    const podStatuses = Object.fromEntries(existingStatuses.concat(newStatuses));
    return { ...status, podStatuses };
}

function getUpdatedStatus(
    status: AllNamespaceItemStatuses,
    clusterResources: NamespaceResources[],
): AllNamespaceItemStatuses {
    const resources = asLookup(clusterResources, (ns) => ns.name);
    const namespaces = Object.keys(resources);
    const namespacesWithStatus = Object.keys(status);
    const existingStatuses = intersection(namespaces, namespacesWithStatus).map((ns) => [
        ns,
        getUpdatedNamespaceItemStatus(status[ns], resources[ns]),
    ]);
    const newStatuses = exclude(namespaces, namespacesWithStatus).map((ns) => [
        ns,
        getUpdatedNamespaceItemStatus({ isExpanded: false, podStatuses: {} }, resources[ns]),
    ]);
    return Object.fromEntries(existingStatuses.concat(newStatuses));
}

export interface ResourceSelectorProps {
    id?: string;
    className?: string;
    resources: NamespaceResources[];
    onSelectionChanged: (selection: { namespace?: string; podName?: string; container?: string }) => void;
    userMessageHandlers: EventHandlers<EventDef>;
}

export function ResourceSelector(props: ResourceSelectorProps) {
    const [status, setStatus] = useState<AllNamespaceItemStatuses>({});
    const [selectedResource, setSelectedResource] = useState<SelectedResource>({});

    const updatedStatus = getUpdatedStatus(status, props.resources);
    useEffect(() => {
        setStatus(updatedStatus);
    }, [props.resources, updatedStatus]);

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
            {renderNamespaceItems(props.resources, updatedStatus)}
        </ul>
    );

    function renderNamespaceItems(items: NamespaceResources[], status: AllNamespaceItemStatuses) {
        return items.map((item) => (
            <li key={item.name}>
                <FontAwesomeIcon
                    className={styles.expander}
                    onClick={() => toggleNamespaceExpanded(item.name)}
                    icon={status[item.name].isExpanded ? faChevronDown : faChevronRight}
                />
                <div className={styles.radioLine}>
                    <input
                        type="radio"
                        className={styles.selector}
                        onChange={(e) => handleNamespaceChange(e, item.name)}
                        checked={isNamespaceResource(selectedResource) && selectedResource.namespace === item.name}
                    ></input>
                    <label className={styles.radioLabel}>{item.name}</label>
                </div>
                {status[item.name].isExpanded && (
                    <ul className={styles.hierarchyList}>
                        {isLoaded(item.children) ? (
                            renderPodItems(item.name, item.children.value, status[item.name].podStatuses)
                        ) : (
                            <VSCodeProgressRing />
                        )}
                    </ul>
                )}
            </li>
        ));
    }

    function renderPodItems(namespace: string, items: PodResources[], status: AllPodItemStatuses) {
        return items.map((item) => (
            <li key={item.name}>
                <FontAwesomeIcon
                    className={styles.expander}
                    onClick={() => togglePodExpanded(namespace, item.name)}
                    icon={status[item.name].isExpanded ? faChevronDown : faChevronRight}
                />
                <div className={styles.radioLine}>
                    <input
                        type="radio"
                        onChange={(e) => handlePodChange(e, namespace, item.name)}
                        checked={
                            isPodResource(selectedResource) &&
                            selectedResource.namespace === namespace &&
                            selectedResource.podName === item.name
                        }
                    ></input>

                    <label className={styles.radioLabel}>{item.name}</label>
                </div>
                {status[item.name].isExpanded && (
                    <ul className={styles.hierarchyList}>
                        {isLoaded(item.children) ? (
                            renderContainerItems(namespace, item.name, item.children.value)
                        ) : (
                            <VSCodeProgressRing />
                        )}
                    </ul>
                )}
            </li>
        ));
    }

    function renderContainerItems(namespace: string, podName: string, containerNames: string[]) {
        return containerNames.map((c) => (
            <li key={c}>
                <div className={styles.radioLine}>
                    <input
                        type="radio"
                        onChange={(e) => handleContainerChange(e, namespace, podName, c)}
                        checked={
                            isContainerResource(selectedResource) &&
                            selectedResource.namespace === namespace &&
                            selectedResource.podName === podName &&
                            selectedResource.container === c
                        }
                    ></input>
                    <label className={styles.radioLabel}>{c}</label>
                </div>
            </li>
        ));
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

    function handleContainerChange(e: ChangeEvent, namespace: string, podName: string, container: string) {
        if ((e.target as HTMLInputElement).checked) {
            setSelectedResource({ namespace, podName, container });
            props.onSelectionChanged({ namespace, podName, container });
        }
    }

    function toggleNamespaceExpanded(namespace: string) {
        const namespaceItem = status[namespace];
        const newNamespaceItem = { ...namespaceItem, isExpanded: !namespaceItem.isExpanded };
        const newStatus = { ...status, [namespace]: newNamespaceItem };
        setStatus(newStatus);

        if (newNamespaceItem.isExpanded) {
            const nsResources = asLookup(props.resources, (ns) => ns.name);
            if (isNotLoaded(nsResources[namespace].children)) {
                props.userMessageHandlers.onSetPodsLoading({ namespace });
                vscode.postGetPodsRequest({ namespace });
            }
        }
    }

    function togglePodExpanded(namespace: string, podName: string) {
        const namespaceItem = status[namespace];
        const podItem = namespaceItem.podStatuses[podName];
        const newPodItem = { ...podItem, isExpanded: !podItem.isExpanded };
        const newPodStatuses = { ...namespaceItem.podStatuses, [podName]: newPodItem };
        const newNamespaceItem = { ...namespaceItem, podStatuses: newPodStatuses };
        const newStatus = { ...status, [namespace]: newNamespaceItem };
        setStatus(newStatus);

        if (newPodItem.isExpanded) {
            const nsResources = asLookup(props.resources, (ns) => ns.name);
            const podResources = lazyAsLookup(nsResources[namespace].children, (pod) => pod.name);
            if (isNotLoaded(podResources[podName].children)) {
                props.userMessageHandlers.onSetContainersLoading({ namespace, podName });
                vscode.postGetContainersRequest({ namespace, podName });
            }
        }
    }
}
