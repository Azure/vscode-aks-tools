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
