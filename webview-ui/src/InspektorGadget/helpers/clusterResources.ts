import { replaceItem } from "../../utilities/array";
import { Lazy, map as lazyMap, newLoaded, newLoading, newNotLoaded } from "../../utilities/lazy";

export interface LazyParent<TChild> {
    name: string;
    children: Lazy<TChild[]>;
}

export type Nodes = Lazy<string[]>;

export type ContainerName = string;
export type PodResources = LazyParent<ContainerName>;
export type NamespaceResources = LazyParent<PodResources>;
export type ClusterResources = Lazy<NamespaceResources[]>;

function updateContainersForPod(podResources: PodResources, containers: string[]): PodResources {
    return { ...podResources, children: newLoaded(containers) };
}

function updateContainersForNamespace(
    namespaceResource: NamespaceResources,
    podName: string,
    containers: string[],
): NamespaceResources {
    const children = lazyMap(namespaceResource.children, (pods) =>
        replaceItem(
            pods,
            (pod) => pod.name === podName,
            (pod) => updateContainersForPod(pod, containers),
        ),
    );
    return { ...namespaceResource, children };
}

function setContainersLoadingForPod(podResources: PodResources): PodResources {
    return { ...podResources, children: newNotLoaded() };
}

function setContainersLoadingForNamespace(namespaceResource: NamespaceResources, podName: string): NamespaceResources {
    const children = lazyMap(namespaceResource.children, (pods) =>
        replaceItem(pods, (pod) => pod.name === podName, setContainersLoadingForPod),
    );
    return { ...namespaceResource, children };
}

export function updateContainersForCluster(
    resources: ClusterResources,
    namespace: string,
    podName: string,
    containers: string[],
): ClusterResources {
    return lazyMap(resources, (nsItems) =>
        replaceItem(
            nsItems,
            (ns) => ns.name === namespace,
            (ns) => updateContainersForNamespace(ns, podName, containers),
        ),
    );
}

function updatePodsForNamespace(namespaceResource: NamespaceResources, podNames: string[]): NamespaceResources {
    const children = newLoaded(podNames.map((p) => ({ name: p, children: newNotLoaded() })));
    return { ...namespaceResource, children };
}

function setPodsLoadingForNamespace(namespaceResource: NamespaceResources): NamespaceResources {
    return { ...namespaceResource, children: newLoading() };
}

export function updatePodsForCluster(
    resources: ClusterResources,
    namespace: string,
    podNames: string[],
): ClusterResources {
    return lazyMap(resources, (nsItems) =>
        replaceItem(
            nsItems,
            (ns) => ns.name === namespace,
            (ns) => updatePodsForNamespace(ns, podNames),
        ),
    );
}

export function updateNamespacesForCluster(namespaces: string[]): ClusterResources {
    const namespaceList = namespaces.map((ns) => ({ name: ns, children: newNotLoaded() }));
    return newLoaded(namespaceList);
}

export function updateNodesForCluster(nodes: string[]): Nodes {
    return newLoaded(nodes);
}

export function setPodsLoading(resources: ClusterResources, namespace: string): ClusterResources {
    return lazyMap(resources, (nsItems) =>
        replaceItem(nsItems, (ns) => ns.name === namespace, setPodsLoadingForNamespace),
    );
}

export function setContainersLoading(resources: ClusterResources, namespace: string, podName: string) {
    return lazyMap(resources, (nsItems) =>
        replaceItem(
            nsItems,
            (ns) => ns.name === namespace,
            (ns) => setContainersLoadingForNamespace(ns, podName),
        ),
    );
}
