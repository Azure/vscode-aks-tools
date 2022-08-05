import { CloudType } from "./commands/utils/clusters";
import AksClusterTreeItem from "./tree/aksClusterTreeItem";

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

export function getCloudType(target: AksClusterTreeItem): CloudType {
    const location = target.resource.location;

    if (location && location.includes("usgov")) {
        return CloudType.USGov;
    }

    return CloudType.Public;
}

function bitAfter(bits: string[], after: string): string | undefined {
    const afterIndex = bits.indexOf(after);
    return bits[afterIndex + 1];
}
