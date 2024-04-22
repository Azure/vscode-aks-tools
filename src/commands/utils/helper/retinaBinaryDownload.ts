import * as vscode from "vscode";
import * as os from "os";
import { getRetinaConfig } from "../config";
import { Errorable, failed } from "../errorable";
import { getToolBinaryPath } from "./binaryDownloadHelper";

async function getLatestRetinaReleaseTag() {
    const retinaConfig = getRetinaConfig();
    if (failed(retinaConfig)) {
        vscode.window.showErrorMessage(retinaConfig.error);
        return undefined;
    }

    return retinaConfig.result.releaseTag;
}

export async function getRetinaBinaryPath(): Promise<Errorable<string>> {
    const releaseTag = await getLatestRetinaReleaseTag();

    if (!releaseTag) {
        return {
            succeeded: false,
            error: `Failed to get latest release tag for downloading retina`,
        };
    }
    const archiveFilename = getArchiveFilename(releaseTag);

    const downloadUrl = `https://github.com/microsoft/retina/releases/download/${releaseTag}/${archiveFilename}`;
    const pathToBinaryInArchive = getPathToBinaryInArchive();

    // The plugin requires an '.exe' extension on Windows, but it doesn't have that in the archive
    // so we can't simply extract it from the path within the archive.
    const binaryFilename = getBinaryFileName();

    return await getToolBinaryPath("kubectl-retina", releaseTag, binaryFilename, {
        downloadUrl,
        isCompressed: true,
        pathToBinaryInArchive,
    });
}

function getArchiveFilename(releaseTag: string) {
    let architecture = os.arch();
    let operatingSystem = os.platform().toLocaleLowerCase();

    if (architecture === "x64") {
        architecture = "amd64";
    }

    if (operatingSystem === "win32") {
        operatingSystem = "windows";
        // scaffolding but will find much better way to handle this
        return `kubectl-retina-${operatingSystem}-${architecture}-${releaseTag}.zip`;
    }

    return `kubectl-retina-${operatingSystem}-${architecture}-${releaseTag}.tar.gz`;
}


function getPathToBinaryInArchive() {
    let architecture = os.arch();
    let operatingSystem = os.platform().toLocaleLowerCase();

    if (architecture === "x64") {
        architecture = "amd64";
    }

    let extension = "";
    if (operatingSystem === "win32") {
        operatingSystem = "windows";
        extension = ".exe";
    }

    return `kubectl-retina-${operatingSystem}-${architecture}${extension}`;
}

function getBinaryFileName() {
    const operatingSystem = os.platform().toLocaleLowerCase();

    let extension = "";
    if (operatingSystem === "win32") {
        extension = ".exe";
    }

    return `kubectl-retina${extension}`;
}
