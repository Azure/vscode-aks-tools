import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as download from '../download/download';
import * as path from 'path';
import { getKubeloginConfig } from '../config';
import { Errorable, failed } from '../errorable';
import { moveFile } from 'move-file';
import { longRunning } from '../host';

function getBaseInstallFolder(): string {
   return path.join(os.homedir(), `.vs-kubernetes/tools`);
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

function checkIfKubeloginBinaryExist(destinationFile: string): boolean {
   return fs.existsSync(destinationFile);
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
      getKubeloginExecutableFileName()
   );

   if (checkIfKubeloginBinaryExist(binaryFilePath)) {
      return {succeeded: true, result: binaryFilePath};
   }

   return await longRunning(`Downloading kubelogin to ${binaryFilePath}.`, () => downloadKubelogin(binaryFilePath, releaseTag));
}

async function downloadKubelogin(binaryFilePath: string, releaseTag: string): Promise<Errorable<string>> {
   const downloadFolder = getDownloadFolder();
   const downloadFileName = getKubeloginZipFileName();
   const downloadFilePath = path.join(downloadFolder, downloadFileName);

   const kubeloginDownloadUrl = `https://github.com/Azure/kubelogin/releases/download/${releaseTag}/${downloadFileName}`;

   const downloadResult = await download.once(kubeloginDownloadUrl, downloadFilePath);
   if (failed(downloadResult)) {
      return {
         succeeded: false,
         error: `Failed to download kubelogin binary from ${kubeloginDownloadUrl}: ${downloadResult.error}`
      };
   }
   const decompress = require("decompress");

   try {
      await decompress(downloadFilePath, downloadFolder);
   } catch (error) {
      return {
         succeeded: false,
         error: `Failed to unzip kubelogin binary ${downloadFilePath} to ${downloadFolder}: ${error}`
      };
   }

   // Remove zip.
   fs.unlinkSync(downloadFilePath);

   // Avoid `download.once()` thinking that the zip file is already downloaded the next time.
   // If there's any failure after this, we *want* it to be downloaded again.
   download.clear(downloadFilePath);

   // Move file to more flatten structure.
   const unzippedBinaryFilePath = getUnzippedKubeloginFilePath(downloadFolder);
   await moveFile(unzippedBinaryFilePath, binaryFilePath);

   //If linux check -- make chmod 0755
   fs.chmodSync(path.join(binaryFilePath), '0755');
   return {succeeded: true, result: binaryFilePath};
}

function getUnzippedKubeloginFilePath(unzippedFolder: string) {
   let architecture = os.arch();
   let operatingSystem = os.platform().toLocaleLowerCase();

   if (architecture === 'x64') {
      architecture = 'amd64';
   }

   if (operatingSystem === 'win32') {
      operatingSystem = 'windows';
   }

   const unzippedBinaryFilename = getKubeloginExecutableFileName();
   return path.join(unzippedFolder, "bin", `${operatingSystem}_${architecture}`, unzippedBinaryFilename);
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

function getKubeloginExecutableFileName() {
   const operatingSystem = os.platform().toLocaleLowerCase();
   const extension = operatingSystem === 'win32' ? '.exe' : '';
   return `kubelogin${extension}`;
}