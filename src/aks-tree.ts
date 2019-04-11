import * as vscode from 'vscode';
import { AzureAccount, AzureSession } from './azure-account';
import { SubscriptionClient, SubscriptionModels, ResourceManagementClient } from 'azure-arm-resource';

export class AKSTreeProvider implements vscode.TreeDataProvider<AKSTreeNode> {
    onDidChangeTreeData?: vscode.Event<AKSTreeNode | null | undefined> | undefined = undefined;

    getTreeItem(element: AKSTreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        if (element.nodeType === 'error') {
            return new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        } else if (element.nodeType === 'subscription') {
            return new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
        } else {
            return new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
        }
    }

    getChildren(element?: AKSTreeNode | undefined): vscode.ProviderResult<AKSTreeNode[]> {
        if (!element) {
            return getRootElements();
        } else if (element.nodeType === 'subscription') {
            return clusters(element.session, element.subscription);
        } else {
            return [];
        }
    }
}

interface SubscriptionItem {
    label: string;
    description: string;
    session: AzureSession;
    subscription: SubscriptionModels.Subscription;
}

async function getRootElements(): Promise<AKSTreeNode[]> {
    const subs = await subscriptions();
    if (subs.length > 0) {
        return subs.map((s) => ({ nodeType: 'subscription', name: s.label, session: s.session, subscription: s.subscription }));
    }
    return [{ nodeType: 'error', message: 'Please log in' }];
}

async function subscriptions(): Promise<SubscriptionItem[]> {
    const azureAccount: AzureAccount = vscode.extensions.getExtension<AzureAccount>('ms-vscode.azure-account')!.exports;
    const subscriptionItems = Array.of<SubscriptionItem>();
    if (azureAccount.status === 'LoggedIn') {
        await azureAccount.waitForFilters();
        for (const session of azureAccount.sessions) {
            const subscriptionClient = new SubscriptionClient.SubscriptionClient(session.credentials);
            const subscriptions = await listAll(subscriptionClient.subscriptions, subscriptionClient.subscriptions.list());
            subscriptionItems.push(...subscriptions
                .filter((s) => azureAccount.filters.some((f) => f.subscription.subscriptionId === s.subscriptionId))
                .map((s) => ({
                    label: s.displayName || '',
                    description: s.subscriptionId || '',
                    session,
                    subscription: s
                })));
        }
    }
    return subscriptionItems;
}

async function clusters(session: AzureSession, subscription: SubscriptionClient.SubscriptionModels.Subscription): Promise<AKSTreeNode[]> {
    const azureAccount: AzureAccount = vscode.extensions.getExtension<AzureAccount>('ms-vscode.azure-account')!.exports;
    if (azureAccount.status === 'LoggedIn') {
        const client = new ResourceManagementClient.ResourceManagementClient(session.credentials, subscription.subscriptionId!);
        const aksClusters = await listAll(client.resources, client.resources.list({ filter: "resourceType eq 'Microsoft.ContainerService/managedClusters'" }));
        return aksClusters.map((c) => ({
            nodeType: 'cluster',
            name: c.name || '<unnamed>',
            resourceGroup: c.id || '<unnamed>'
        }));
    }
    return [ { nodeType: 'error', message: 'what gives' } ];
}

export interface AKSErrorTreeNode {
    readonly nodeType: 'error';
    readonly message: string;
}

export interface AKSSubscriptionTreeNode {
    readonly nodeType: 'subscription';
    readonly name: string;
    readonly session: AzureSession;
    readonly subscription: SubscriptionClient.SubscriptionModels.Subscription;
}

export interface AKSClusterTreeNode {
    readonly nodeType: 'cluster';
    readonly resourceGroup: string;
    readonly name: string;
}

export type AKSTreeNode = AKSClusterTreeNode | AKSSubscriptionTreeNode | AKSErrorTreeNode;

export interface PartialList<T> extends Array<T> {
    nextLink?: string;
}

async function listAll<T>(client: { listNext(nextPageLink: string): Promise<PartialList<T>>; }, first: Promise<PartialList<T>>): Promise<T[]> {
    const all: T[] = [];
    for (let list = await first; list.length || list.nextLink; list = list.nextLink ? await client.listNext(list.nextLink) : []) {
        all.push(...list);
    }
    return all;
}
