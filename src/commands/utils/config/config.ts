import path = require('path');
import * as os from 'os';

function getBaseInstallFolder(): string {
    return path.join(os.homedir(), `.vs-kubernetes/tools/gadget`);
}

function getGadgetBinaryFolder(): string {
    return path.join(getBaseInstallFolder());
}

export function toolPath(tool: string): string | undefined {
    return getGadgetBinaryFolder();
}
