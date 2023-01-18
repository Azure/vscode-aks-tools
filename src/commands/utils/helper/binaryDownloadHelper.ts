import * as download from '../download/download';
import * as os from 'os';
import * as fs from 'fs';
import { moveFile } from 'move-file';
import { Errorable, failed } from "../errorable";
import path = require("path");

export async function downloadBinary(
    binaryFilePath: string,
    binaryName: string,
    downloadFolder: string,
    binaryDownloadUrl: string,
    downloadFileName: string
): Promise<Errorable<string>> {

    const downloadFilePath = path.join(downloadFolder, downloadFileName);

    const downloadResult = await download.once(binaryDownloadUrl, downloadFilePath);
    if (failed(downloadResult)) {
        return {
            succeeded: false,
            error: `Failed to download binary from ${binaryDownloadUrl}: ${downloadResult.error}`
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
    const unzippedBinaryFilePath = getUnzippedBinaryFilePath(downloadFolder, binaryName);

    if (unzippedBinaryFilePath === undefined) {
        return  { succeeded: false, error: `${binaryName} is not supported.` };
    }

    await moveFile(unzippedBinaryFilePath, binaryFilePath);

    //If linux check -- make chmod 0755
    fs.chmodSync(path.join(binaryFilePath), '0755');
    return { succeeded: true, result: binaryFilePath };
}

export function getBinaryExecutableFileName(binaryName: string) {
    const operatingSystem = os.platform().toLocaleLowerCase();
    const extension = operatingSystem === 'win32' ? '.exe' : '';
    return `${binaryName}${extension}`;
}

export function checkIfKubeloginBinaryExist(destinationFile: string): boolean {
    return fs.existsSync(destinationFile);
 } 

function getUnzippedBinaryFilePath(unzippedFolder: string, binaryName: string) {
    let architecture = os.arch();
    let operatingSystem = os.platform().toLocaleLowerCase();

    if (architecture === 'x64') {
        architecture = 'amd64';
    }

    if (operatingSystem === 'win32') {
        operatingSystem = 'windows';
    }

    const unzippedBinaryFilename = getBinaryExecutableFileName(binaryName);

    switch (binaryName) {
        case "kubelogin":
            return path.join(unzippedFolder, "bin", `${operatingSystem}_${architecture}`, unzippedBinaryFilename);
        case "kubectl-gadget":
            return path.join(unzippedFolder, unzippedBinaryFilename);
    }

    return;
}
