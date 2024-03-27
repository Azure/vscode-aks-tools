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
    const pathToBinaryInArchive = getPathToBinaryInArchive();

    const downloadUrl = `https://github.com/microsoft/retina/releases/download/${releaseTag}/${archiveFilename}`;
  
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
    }

    return `kubectl-retina-${operatingSystem}-${architecture}-${releaseTag}.tar.gz`;
}


function getPathToBinaryInArchive() {
    return "kubectl-retina";
}

function getBinaryFileName() {
    let architecture = os.arch();
    const operatingSystem = os.platform().toLocaleLowerCase();

    if (architecture === "x64") {
        architecture = "amd64";
    }

    const retinaBinaryFile = `kubectl-retina-${operatingSystem}-${architecture}`;

    return retinaBinaryFile;
}
