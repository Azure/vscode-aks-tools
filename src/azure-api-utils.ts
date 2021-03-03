import { ISubscriptionContext } from "vscode-azureextensionui";
// import { SubscriptionClient } from 'azure-arm-resource';
import { SubscriptionModels } from '@azure/arm-subscriptions';

export interface PartialList<T> extends Array<T> {
    nextLink?: string;
}

export async function listAll<T>(client: { listNext(nextPageLink: string): Promise<PartialList<T>>; }, first: Promise<PartialList<T>>): Promise<T[]> {
    const all: T[] = [];
    for (let list = await first; list.length || list.nextLink; list = list.nextLink ? await client.listNext(list.nextLink) : []) {
        all.push(...list);
    }
    return all;
}

export function parseResource(armId: string): { resourceGroupName: string | undefined, name: string | undefined } {
    const bits = armId.split('/');
    const resourceGroupName = bitAfter(bits, 'resourceGroups');
    const name = bits[bits.length - 1];
    return { resourceGroupName, name };
}

function bitAfter(bits: string[], after: string): string | undefined {
    const afterIndex = bits.indexOf(after);
    return bits[afterIndex + 1];
}

export function toSubscription(context: ISubscriptionContext): SubscriptionModels.Subscription {
    return {
        id: context.subscriptionPath,
        subscriptionId: context.subscriptionId,
        displayName: context.subscriptionDisplayName
    };
}