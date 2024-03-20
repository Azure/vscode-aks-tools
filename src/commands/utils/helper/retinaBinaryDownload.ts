import * as vscode from "vscode";
import * as os from "os";
import { getRetinaConfig } from "../config";
import { Errorable, failed } from "../errorable";
import { getToolBinaryPath } from "./binaryDownloadHelper";
import path from "path";

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

    const retinaBinaryFile = getBinaryFileName();
    const downloadUrl = `https://github.com/microsoft/retina/releases/download/${releaseTag}/${retinaBinaryFile}`;
    const binaryFilename = path.basename(retinaBinaryFile);

    return await getToolBinaryPath("retina", releaseTag, binaryFilename, { downloadUrl, isCompressed: false });
}

function getBinaryFileName() {
    let architecture = os.arch();

    if (architecture === "x64") {
        architecture = "amd64";
    }

    const retinaBinaryFile = `kubectl-retina-linux-${architecture}`;

    return retinaBinaryFile;
}
