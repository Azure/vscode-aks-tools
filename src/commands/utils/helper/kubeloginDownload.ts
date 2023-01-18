import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { getKubeloginConfig } from '../config';
import { Errorable, failed } from '../errorable';
import { longRunning } from '../host';
import { checkIfKubeloginBinaryExist, downloadBinary, getBinaryExecutableFileName } from './binaryDownloadHelper';

const KUBELOGIN_BINARY_NAME: string = "kubelogin";

function getBaseInstallFolder(): string {
   return path.join(os.homedir(), `.vs-kubernetes/tools/kubelogin`);
}

function getKubeloginBinaryFolder(releaseTag: string): string {
   return path.join(getBaseInstallFolder(), releaseTag);
}

function getDownloadFolder(): string {
   return path.join(getBaseInstallFolder(), "download");
}

async function getLatestKubeloginReleaseTag() {
   const kubeloginConfig = getKubeloginConfig();
   if (failed(kubeloginConfig)) {
      vscode.window.showErrorMessage(kubeloginConfig.error);
      return undefined;
   }

   return kubeloginConfig.result.releaseTag;
}

export async function getKubeloginBinaryPath(): Promise<Errorable<string>> {
   // 0. Get latest release tag.
   // 1: check if file already exist.
   // 2: if not Download latest.
   const releaseTag = await getLatestKubeloginReleaseTag();

   if (!releaseTag) {
      return {succeeded: false, error: "Could not get latest release tag."};
   }

   const binaryFolder = getKubeloginBinaryFolder(releaseTag);

   const binaryFilePath = path.join(
      binaryFolder,
      getBinaryExecutableFileName(KUBELOGIN_BINARY_NAME)
   );

   if (checkIfKubeloginBinaryExist(binaryFilePath)) {
      return {succeeded: true, result: binaryFilePath};
   }

   return await longRunning(`Downloading kubelogin to ${binaryFilePath}.`, () => downloadKubelogin(binaryFilePath, releaseTag));
}

async function downloadKubelogin(binaryFilePath: string, releaseTag: string): Promise<Errorable<string>> {
   const downloadFolder = getDownloadFolder();
   const downloadFileName = getKubeloginZipFileName();
   const kubeloginDownloadUrl = `https://github.com/Azure/kubelogin/releases/download/${releaseTag}/${downloadFileName}`;

   const binaryFileDownloadResult = await downloadBinary(binaryFilePath, KUBELOGIN_BINARY_NAME, downloadFolder, kubeloginDownloadUrl, downloadFileName);
   
   return binaryFileDownloadResult;
}

function getKubeloginZipFileName() {
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
