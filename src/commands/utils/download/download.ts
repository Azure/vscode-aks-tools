import * as path from "path";
import { succeeded, Errorable, getErrorMessage } from "../errorable";
import { Dictionary } from "../dictionary";
import { sleep } from "../sleep";
import download from "download";

const DOWNLOAD_ONCE_STATUS: Dictionary<DownloadOperationStatus> = {};

enum DownloadOperationStatus {
    Queued = 1,
    Completed = 2,
    Failed = 3,
}

export async function to(sourceUrl: string, destinationFile: string): Promise<Errorable<null>> {
    try {
        await download(sourceUrl, path.dirname(destinationFile), {
            filename: path.basename(destinationFile),
        });

        return { succeeded: true, result: null };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function once(sourceUrl: string, destinationFile: string): Promise<Errorable<null>> {
    const downloadStatus = DOWNLOAD_ONCE_STATUS[destinationFile];
    if (!downloadStatus || downloadStatus === DownloadOperationStatus.Failed) {
        DOWNLOAD_ONCE_STATUS[destinationFile] = DownloadOperationStatus.Queued;
        const result = await to(sourceUrl, destinationFile);
        DOWNLOAD_ONCE_STATUS[destinationFile] = succeeded(result)
            ? DownloadOperationStatus.Completed
            : DownloadOperationStatus.Failed;
        return result;
    } else {
        for (;;) {
            await sleep(100);
            if (DOWNLOAD_ONCE_STATUS[destinationFile] === DownloadOperationStatus.Completed) {
                return { succeeded: true, result: null };
            } else {
                return await once(sourceUrl, destinationFile);
            }
        }
    }
}

export async function clear(downloadedFilePath: string) {
    delete DOWNLOAD_ONCE_STATUS[downloadedFilePath];
}
