import * as vscode from "vscode";
import * as os from "os";
import { getDraftConfig } from "../config";
import { Errorable, failed } from "../errorable";
import { getToolBinaryPath } from "./binaryDownloadHelper";

async function getLatestDraftReleaseTag() {
    const draftConfig = getDraftConfig();
    if (failed(draftConfig)) {
        vscode.window.showErrorMessage(draftConfig.error);
        return undefined;
    }

    return draftConfig.result.releaseTag;
}

export async function getDraftBinaryPath(): Promise<Errorable<string>> {
    const releaseTag = await getLatestDraftReleaseTag();

    if (!releaseTag) {
        return {
            succeeded: false,
            error: `Failed to get latest release tag for downloading draft`,
        };
    }

    const downloadFileName = getDownloadFileName();
    const downloadUrl = `https://github.com/Azure/draft/releases/download/${releaseTag}/${downloadFileName}`;
    const executableFileName = getExecutableFileName();

    return await getToolBinaryPath("draft", releaseTag, executableFileName, { downloadUrl, isCompressed: false });
}

function getDownloadFileName() {
    let architecture = os.arch();
    let operatingSystem = os.platform().toLocaleLowerCase();

    if (architecture === "x64") {
        architecture = "amd64";
    }
    let draftBinaryFile = `draft-${operatingSystem}-${architecture}`;

    if (operatingSystem === "win32") {
        operatingSystem = "windows";
        // Draft release v0.0.22 the file name has exe associated with it.
        draftBinaryFile = `draft-${operatingSystem}-${architecture}.exe`;
    }

    return draftBinaryFile;
}

function getExecutableFileName() {
    const operatingSystem = os.platform().toLocaleLowerCase();
    const extension = operatingSystem === "win32" ? ".exe" : "";
    return `draft${extension}`;
}
