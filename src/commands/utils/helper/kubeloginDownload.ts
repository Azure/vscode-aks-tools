import * as vscode from 'vscode';
import * as os from 'os';
import path = require("path");
import { getKubeloginConfig } from '../config';
import { Errorable, failed } from '../errorable';
import { getToolBinaryPath } from './binaryDownloadHelper';

async function getLatestKubeloginReleaseTag() {
   const kubeloginConfig = getKubeloginConfig();
   if (failed(kubeloginConfig)) {
      vscode.window.showErrorMessage(kubeloginConfig.error);
      return undefined;
   }

   return kubeloginConfig.result.releaseTag;
}

export async function getKubeloginBinaryPath(): Promise<Errorable<string>> {
    const releaseTag = await getLatestKubeloginReleaseTag();
    if (!releaseTag) {
         return {succeeded: false, error: "Could not get latest release tag."};
    }

    const archiveFilename = getArchiveFilename();
    const downloadUrl = `https://github.com/Azure/kubelogin/releases/download/${releaseTag}/${archiveFilename}`;
    const pathToBinaryInArchive = getPathToBinaryInArchive();
    const binaryFilename = path.basename(pathToBinaryInArchive);

    return await getToolBinaryPath("kubelogin", releaseTag, downloadUrl, pathToBinaryInArchive, binaryFilename);
}

function getArchiveFilename() {
    let architecture = os.arch();
    let operatingSystem = os.platform().toLocaleLowerCase();
    
    if (architecture === 'x64') {
        architecture = 'amd64';
    }

    if (operatingSystem === 'win32') {
        operatingSystem = 'win';
    }

    return `kubelogin-${operatingSystem}-${architecture}.zip`;
}

function getPathToBinaryInArchive() {
   let architecture = os.arch();
   let operatingSystem = os.platform().toLocaleLowerCase();

   if (architecture === 'x64') {
       architecture = 'amd64';
   }

   let extension = '';
   if (operatingSystem === 'win32') {
       operatingSystem = 'windows';
       extension = '.exe'
   }

   return path.join('bin', `${operatingSystem}_${architecture}`, `kubelogin${extension}`);
}
