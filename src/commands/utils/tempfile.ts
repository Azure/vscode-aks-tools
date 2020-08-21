import { fs } from './fs';
const tmp = require('tmp');

export async function withOptionalTempFile<T>(
    content: string | undefined,
    fileType: string,
    fn: (filename: string | undefined) => Promise<T>): Promise<T> {
    if (!content) {
        return fn(undefined);
    }

    const tempFile = tmp.fileSync({ prefix: "aks-periscope-", postfix: `.${fileType}` });
    await fs.writeFile(tempFile.name, content);

    try {
        return await fn(tempFile.name);
    } finally {
        tempFile.removeCallback();
    }
}
