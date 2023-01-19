import * as download from '../download/download';
import * as os from 'os';
import * as fs from 'fs';
import { moveFile } from 'move-file';
import { Errorable, failed } from "../errorable";
import path = require("path");
import { longRunning } from '../host';

function getToolBaseInstallFolder(toolName: string): string {
    return path.join(os.homedir(), `.vs-kubernetes/tools/${toolName}`);
}

function getToolBinaryFolder(toolName: string, version: string): string {
    return path.join(getToolBaseInstallFolder(toolName), version);
}

function getToolDownloadFolder(toolName: string): string {
    return path.join(getToolBaseInstallFolder(toolName), "download");
}
 
export async function getToolBinaryPath(
    toolName: string,
    version: string,
    downloadUrl: string,
    pathToBinaryInArchive: string,
    binaryFilename: string,
    ): Promise<Errorable<string>> {

    const binaryFolder = getToolBinaryFolder(toolName, version);
    const binaryFilePath = path.join(binaryFolder, binaryFilename);

    if (fs.existsSync(binaryFilePath)) {
       return {succeeded: true, result: binaryFilePath};
    }
 
    return await longRunning(`Downloading kubectl-gadget to ${binaryFilePath}.`, () => downloadBinary(toolName, binaryFilePath, downloadUrl, pathToBinaryInArchive));
}

async function downloadBinary(
    toolName: string,
    binaryFilePath: string,
    downloadUrl: string,
    pathToBinaryInArchive: string
): Promise<Errorable<string>> {

    const downloadFileName = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1);
    const downloadFolder = getToolDownloadFolder(toolName);
    const downloadFilePath = path.join(downloadFolder, downloadFileName);

    const downloadResult = await download.once(downloadUrl, downloadFilePath);
    if (failed(downloadResult)) {
        return {
            succeeded: false,
            error: `Failed to download binary from ${downloadUrl}: ${downloadResult.error}`
        };
    }
    const decompress = require("decompress");

    try {
        await decompress(downloadFilePath, downloadFolder);
    } catch (error) {
        return {
            succeeded: false,
            error: `Failed to unzip binary ${downloadFilePath} to ${downloadFolder}: ${error}`
        };
    }

    // Remove zip.
    fs.unlinkSync(downloadFilePath);

    // Avoid `download.once()` thinking that the zip file is already downloaded the next time.
    // If there's any failure after this, we *want* it to be downloaded again.
    download.clear(downloadFilePath);

    // Move file to more flatten structure.
    const unzippedBinaryFilePath = path.join(downloadFolder, pathToBinaryInArchive);

    await moveFile(unzippedBinaryFilePath, binaryFilePath);

    //If linux check -- make chmod 0755
    fs.chmodSync(path.join(binaryFilePath), '0755');
    return { succeeded: true, result: binaryFilePath };
}
