import * as path from "path";
import { succeeded, Errorable, getErrorMessage } from "../errorable";
import { Dictionary } from "../dictionary";
import { sleep } from "../sleep";
import { mkdir } from "fs/promises";
import { WriteStream, createWriteStream } from "fs";
import fetch from "node-fetch";

const DOWNLOAD_ONCE_STATUS: Dictionary<DownloadOperationStatus> = {};

enum DownloadOperationStatus {
    Queued = 1,
    Completed = 2,
    Failed = 3,
}

export async function to(sourceUrl: string, destinationFile: string): Promise<Errorable<null>> {
    try {
        await download(sourceUrl, destinationFile);

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

async function download(url: string, outputFilepath: string): Promise<Errorable<void>> {
    const directory = path.dirname(outputFilepath);
    try {
        await mkdir(directory, { recursive: true });
    } catch (e) {
        return { succeeded: false, error: `Unable to create directory ${directory}: ${getErrorMessage(e)}` };
    }

    let fileStream: WriteStream;
    try {
        fileStream = createWriteStream(outputFilepath);
    } catch (e) {
        return { succeeded: false, error: `Unable to create file ${outputFilepath}: ${getErrorMessage(e)}` };
    }

    try {
        const response = await fetch(url);
        if (response.body === null) {
            return { succeeded: false, error: `No body in response from ${url}` };
        }

        for await (const chunk of response.body) {
            fileStream.write(chunk);
        }
    } catch (e) {
        return { succeeded: false, error: `Error downloading from ${url} to ${outputFilepath}: ${getErrorMessage(e)}` };
    } finally {
        fileStream.end();
    }

    return { succeeded: true, result: undefined };
}
