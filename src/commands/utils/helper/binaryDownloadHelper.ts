import * as download from "../download/download";
import * as os from "os";
import * as fs from "fs";
import { moveFile } from "move-file";
import { Errorable, failed } from "../errorable";
import path from "path";
import { longRunning } from "../host";

function getToolBaseInstallFolder(toolName: string): string {
    return path.join(os.homedir(), `.vs-kubernetes/tools/${toolName}`);
}

function getToolBinaryFolder(toolName: string, version: string): string {
    return path.join(getToolBaseInstallFolder(toolName), version);
}

function getToolDownloadFolder(toolName: string): string {
    return path.join(getToolBaseInstallFolder(toolName), "download");
}

type CommonDownloadSpec = {
    downloadUrl: string;
};

export type BinaryDownloadSpec = CommonDownloadSpec & {
    isCompressed: false;
};

export type ArchiveDownloadSpec = CommonDownloadSpec & {
    isCompressed: true;
    pathToBinaryInArchive: string;
};

export type DownloadSpec = BinaryDownloadSpec | ArchiveDownloadSpec;

function isArchive(downloadSpec: DownloadSpec): downloadSpec is ArchiveDownloadSpec {
    return downloadSpec.isCompressed;
}

export async function getToolBinaryPath(
    toolName: string,
    version: string,
    binaryFilename: string,
    downloadSpec: DownloadSpec,
): Promise<Errorable<string>> {
    const binaryFolder = getToolBinaryFolder(toolName, version);
    const binaryFilePath = path.join(binaryFolder, binaryFilename);

    if (fs.existsSync(binaryFilePath)) {
        return { succeeded: true, result: binaryFilePath };
    }

    return await longRunning(`Downloading ${toolName} to ${binaryFilePath}.`, () =>
        downloadTool(toolName, binaryFilePath, downloadSpec),
    );
}

async function downloadTool(
    toolName: string,
    binaryFilePath: string,
    downloadSpec: DownloadSpec,
): Promise<Errorable<string>> {
    const downloadFileName = downloadSpec.downloadUrl.substring(downloadSpec.downloadUrl.lastIndexOf("/") + 1);
    const downloadFolder = getToolDownloadFolder(toolName);
    const downloadFilePath = path.join(downloadFolder, downloadFileName);

    const downloadResult = await download.once(downloadSpec.downloadUrl, downloadFilePath);
    if (failed(downloadResult)) {
        return {
            succeeded: false,
            error: `Failed to download binary from ${downloadSpec.downloadUrl}: ${downloadResult.error}`,
        };
    }

    if (isArchive(downloadSpec)) {
        const { default: decompress } = await import("decompress");

        try {
            await decompress(downloadFilePath, downloadFolder);
        } catch (error) {
            return {
                succeeded: false,
                error: `Failed to unzip binary ${downloadFilePath} to ${downloadFolder}: ${error}`,
            };
        }

        // Remove zip.
        fs.unlinkSync(downloadFilePath);

        // Move extracted binary to where we want it.
        const unzippedBinaryFilePath = path.join(downloadFolder, downloadSpec.pathToBinaryInArchive);
        await moveFile(unzippedBinaryFilePath, binaryFilePath);
    } else {
        await moveFile(downloadFilePath, binaryFilePath);
    }

    // Avoid `download.once()` thinking that the downloaded file is already downloaded the next time.
    // If there's any failure after this, we *want* it to be downloaded again.
    download.clear(downloadFilePath);

    // If linux check -- make chmod 0755
    fs.chmodSync(path.join(binaryFilePath), "0755");
    return { succeeded: true, result: binaryFilePath };
}
