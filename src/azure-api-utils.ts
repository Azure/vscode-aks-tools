export function parseResource(armId: string): {
    parentResourceId: string | undefined;
    subscriptionId: string | undefined;
    resourceGroupName: string | undefined;
    name: string | undefined;
} {
    // General armId Format: /subscriptions/{subid}/resourcegroups/{group}/providers/.../{name}
    // armId format of a member cluster, given parentResource is a Fleet {parentResourceId}/members/{name}
    const bits = armId.split("/").filter((bit) => bit.length > 0);
    const resourceGroupName = bits[3];
    const subscriptionId = bits[1];
    const name = bits[bits.length - 1];
    const parentResourceId = `/${bits.slice(0, bits.length - 2).join("/")}`; // take all except for the last two bits
    return { parentResourceId, subscriptionId, resourceGroupName, name };
}

export function parseSubId(armId: string): { subId: string } {
    // /subscriptions/{subid}/resourcegroups/{group}/providers/.../{name}
    const bits = armId.split("/").filter((bit) => bit.length > 0);
    const subId = bits[1];
    return { subId };
}
