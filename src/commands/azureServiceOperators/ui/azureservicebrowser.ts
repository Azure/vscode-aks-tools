// import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as vscode from 'vscode';

 export class AzureServiceBrowser implements k8s.ClusterExplorerV1.NodeContributor {
    constructor(private readonly explorer: k8s.ClusterExplorerV1) {}
    contributesChildren(parent: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined): boolean {
        return !!parent && parent.nodeType === 'context';
    }
    async getChildren(parent: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined): Promise<k8s.ClusterExplorerV1.Node[]> {
        if (this.contributesChildren(parent)) {
            return [new AzureServicesFolderNode(this.explorer)];
        }
        return [];
    }
}

 class AzureServicesFolderNode implements k8s.ClusterExplorerV1.Node {
    constructor(private readonly explorer: k8s.ClusterExplorerV1) {}
    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        const pinnedNodes = (await pinnedServiceKinds()).map((k) => new PinnedAzureServiceKindNode(this.explorer, k));
        const allNode = new AllAzureServicesFolderNode(this.explorer);
        return [...pinnedNodes, allNode];
    }
    getTreeItem(): TreeItem {
        const treeItem = new TreeItem("Azure Services", TreeItemCollapsibleState.Collapsed);
        treeItem.contextValue = "aks.aso.azureservices";
        return treeItem;
    }
}

 class AllAzureServicesFolderNode implements k8s.ClusterExplorerV1.Node {
    constructor(private readonly explorer: k8s.ClusterExplorerV1) {}
    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        const all = await allServiceKinds();

        return all.map((k) => new AzureServiceKindNode(this.explorer, k));
    }
    getTreeItem(): TreeItem {
        const treeItem = new TreeItem("All Service Types", TreeItemCollapsibleState.Collapsed);
        treeItem.contextValue = "aks.aso.allservices";
        return treeItem;
    }

 }

 class AzureServiceKindNode  implements k8s.ClusterExplorerV1.Node {
    constructor(private readonly explorer: k8s.ClusterExplorerV1, private readonly kind: AzureServiceKind) {}
    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        const allFolderChildren = this.explorer.nodeSources.resourceFolder(this.kind.displayName, this.kind.displayName, this.kind.manifestKind, this.kind.abbreviation);

        return allFolderChildren.nodes();
    }
    getTreeItem(): TreeItem {
        const treeItem = new TreeItem(this.kind.displayName, TreeItemCollapsibleState.Collapsed);
        treeItem.contextValue = "aks.aso.allservices.serviceitem";

        return treeItem;
    }
}

class PinnedAzureServiceKindNode  implements k8s.ClusterExplorerV1.Node {
    constructor(private readonly explorer: k8s.ClusterExplorerV1, private readonly kind: AzureServiceKind) {}
    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        const allFolderChildren = this.explorer.nodeSources.resourceFolder(this.kind.displayName, this.kind.displayName, this.kind.manifestKind, this.kind.abbreviation);

        return allFolderChildren.nodes();
    }
    getTreeItem(): TreeItem {
        const treeItem = new TreeItem(this.kind.displayName, TreeItemCollapsibleState.Collapsed);
        treeItem.contextValue = "aks.aso.azureservices.pinnedserviceitem";
        return treeItem;
    }
}

export interface AzureServiceKind {
    readonly displayName: string;
    readonly manifestKind: string;
    readonly abbreviation: string;
}

async function pinnedServiceKinds(): Promise<AzureServiceKind[]> {
    const pinnedKindNames = <AzureServiceKind[]>vscode.workspace.getConfiguration().get('aso.pinned');

    return pinnedKindNames;
}

// should be errorable but skip for prototype
async function allServiceKinds(): Promise<AzureServiceKind[]> {
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        return [];  // TODO: ERROR
    }
    const sr = await kubectl.api.invokeCommand("api-resources --api-group azure.microsoft.com --no-headers");
    if (!sr || sr.code !== 0) {
        return [];  // TODO: ERROR
    }

    const lines = sr.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return lines.map((l) => parseServiceResource(l));
}

function parseServiceResource(text: string): AzureServiceKind {
    const bits = text.split(' ').filter((s) => s.length > 0);
    if (bits.length === 4) {
        // name, apigroup, namespaced, kind
        return { displayName: bits[3], manifestKind: bits[3], abbreviation: bits[0] };
    } else if (bits.length === 5) {
        // name, shortnames, apigroup, namespaced, kind
        return { displayName: bits[4], manifestKind: bits[4], abbreviation: bits[0] };
    } else {
        return { displayName: "WAT " + text, manifestKind: "WAT", abbreviation: "wat" };
    }
}