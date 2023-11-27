import * as vscode from "vscode";
import * as os from "os";
import { getKubectlGadgetConfig } from "../config";
import { Errorable, failed } from "../errorable";
import { getToolBinaryPath } from "./binaryDownloadHelper";

async function getLatestKubectlGadgetReleaseTag() {
    const kubegadgetConfig = getKubectlGadgetConfig();
    if (failed(kubegadgetConfig)) {
        vscode.window.showErrorMessage(kubegadgetConfig.error);
        return undefined;
    }

    return kubegadgetConfig.result.releaseTag;
}

export async function getKubectlGadgetBinaryPath(): Promise<Errorable<string>> {
    const releaseTag = await getLatestKubectlGadgetReleaseTag();
    if (!releaseTag) {
        return { succeeded: false, error: "Could not get latest release tag." };
    }

    const archiveFilename = getArchiveFilename(releaseTag);
    const downloadUrl = `https://github.com/inspektor-gadget/inspektor-gadget/releases/download/${releaseTag}/${archiveFilename}`;
    const pathToBinaryInArchive = getPathToBinaryInArchive();

    // The plugin requires an '.exe' extension on Windows, but it doesn't have that in the archive
    // so we can't simply extract it from the path within the archive.
    const binaryFilename = getBinaryFilename();

    return await getToolBinaryPath("kubectl-gadget", releaseTag, binaryFilename, {
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

    return `kubectl-gadget-${operatingSystem}-${architecture}-${releaseTag}.tar.gz`;
}

function getPathToBinaryInArchive() {
    return "kubectl-gadget";
}

function getBinaryFilename() {
    const operatingSystem = os.platform().toLocaleLowerCase();

    let extension = "";
    if (operatingSystem === "win32") {
        extension = ".exe";
    }

    return `kubectl-gadget${extension}`;
}
