import * as download from "../download/download";
import * as os from "os";
import * as fs from "fs";
import { moveFile } from "move-file";
import { Errorable, failed } from "../errorable";
import path from "path";
import { pipeline } from "stream/promises";
import * as tar from "tar";
import * as yauzl from "yauzl";
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

/**
 * Archive entry paths are always '/'-separated, but `pathToBinaryInArchive` is
 * built with `path.join`, which yields '\' on Windows. Compare in one form.
 */
function toArchiveEntryPath(filePath: string): string {
    return filePath.split(path.sep).join("/").replace(/^\.\//, "");
}

/**
 * Extracts a single known entry from a zip, streaming it straight to `destPath`.
 *
 * Only the entry we asked for is written, and it is written to a path we
 * computed ourselves, so a malicious archive cannot direct a write elsewhere
 * (the Zip Slip / hardlink class of bug).
 */
function extractFileFromZip(archivePath: string, entryPath: string, destPath: string): Promise<void> {
    const wantedEntry = toArchiveEntryPath(entryPath);

    return new Promise((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
            if (openError || !zipFile) {
                reject(openError ?? new Error("Failed to open archive."));
                return;
            }

            let found = false;

            zipFile.on("error", reject);

            zipFile.on("entry", (entry: yauzl.Entry) => {
                if (toArchiveEntryPath(entry.fileName) !== wantedEntry) {
                    zipFile.readEntry();
                    return;
                }

                found = true;
                zipFile.openReadStream(entry, (streamError, readStream) => {
                    if (streamError || !readStream) {
                        reject(streamError ?? new Error(`Failed to read ${wantedEntry} from archive.`));
                        return;
                    }

                    pipeline(readStream, fs.createWriteStream(destPath)).then(() => {
                        zipFile.close();
                        resolve();
                    }, reject);
                });
            });

            zipFile.on("end", () => {
                if (!found) {
                    reject(new Error(`Archive does not contain an entry named ${wantedEntry}.`));
                }
            });

            zipFile.readEntry();
        });
    });
}

/**
 * Extracts a single known entry from a gzipped tarball. Same guarantee as
 * `extractFileFromZip`: one entry, written only to `destPath`.
 */
async function extractFileFromTarball(archivePath: string, entryPath: string, destPath: string): Promise<void> {
    const wantedEntry = toArchiveEntryPath(entryPath);
    let writeCompleted: Promise<void> | undefined;

    await tar.list({
        file: archivePath,
        onReadEntry: (entry) => {
            if (toArchiveEntryPath(entry.path) !== wantedEntry) {
                // Leave it unconsumed; tar drains entries we don't attach to.
                return;
            }

            writeCompleted = pipeline(entry, fs.createWriteStream(destPath));
        },
    });

    if (!writeCompleted) {
        throw new Error(`Archive does not contain an entry named ${wantedEntry}.`);
    }

    await writeCompleted;
}

async function extractBinaryFromArchive(archivePath: string, entryPath: string, destPath: string): Promise<void> {
    const lowerCaseArchivePath = archivePath.toLowerCase();

    if (lowerCaseArchivePath.endsWith(".zip")) {
        await extractFileFromZip(archivePath, entryPath, destPath);
        return;
    }

    if (lowerCaseArchivePath.endsWith(".tar.gz") || lowerCaseArchivePath.endsWith(".tgz")) {
        await extractFileFromTarball(archivePath, entryPath, destPath);
        return;
    }

    throw new Error(`Unsupported archive format: ${path.basename(archivePath)}. Expected .zip, .tar.gz or .tgz.`);
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
        downloadTool(toolName, binaryFolder, binaryFilePath, downloadSpec),
    );
}

async function downloadTool(
    toolName: string,
    binaryFolder: string,
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
        // Extract to a temporary path alongside the destination and rename only on
        // success, so a failed extraction can't leave a truncated binary at
        // `binaryFilePath` for the `existsSync` check above to find next time.
        fs.mkdirSync(binaryFolder, { recursive: true });
        const partialFilePath = `${binaryFilePath}.partial`;

        try {
            await extractBinaryFromArchive(downloadFilePath, downloadSpec.pathToBinaryInArchive, partialFilePath);
            fs.renameSync(partialFilePath, binaryFilePath);
        } catch (error) {
            fs.rmSync(partialFilePath, { force: true });
            return {
                succeeded: false,
                error: `Failed to extract ${downloadSpec.pathToBinaryInArchive} from ${downloadFilePath}: ${error}`,
            };
        } finally {
            // Remove the archive whether or not extraction succeeded.
            fs.rmSync(downloadFilePath, { force: true });
        }
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
