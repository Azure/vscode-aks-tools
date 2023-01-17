import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as download from '../download/download';
import * as path from 'path';
import { getKubectlGadgetConfig } from '../config';
import { Errorable, failed } from '../errorable';
import { moveFile } from 'move-file';
import { longRunning } from '../host';

function getBaseInstallFolder(): string {
   return path.join(os.homedir(), `.vs-kubernetes/tools/kubectlgadget`);
}

function getKubectlGadgetBinaryFolder(releaseTag: string): string {
   return path.join(getBaseInstallFolder(), releaseTag);
}

function getDownloadFolder(): string {
   return path.join(getBaseInstallFolder(), "download");
}

async function getLatestKubectlGadgetReleaseTag() {
   const kubegadgetConfig = getKubectlGadgetConfig();
   if (failed(kubegadgetConfig)) {
      vscode.window.showErrorMessage(kubegadgetConfig.error);
      return undefined;
   }

   return kubegadgetConfig.result.releaseTag;
}

function checkIfkubeGadgetBinaryExist(destinationFile: string): boolean {
   return fs.existsSync(destinationFile);
}

export async function getKubectlGadgetBinaryPath(): Promise<Errorable<string>> {
   // 0. Get latest release tag.
   // 1: check if file already exist.
   // 2: if not Download latest.
   const releaseTag = await getLatestKubectlGadgetReleaseTag();

   if (!releaseTag) {
      return {succeeded: false, error: "Could not get latest release tag."};
   }

   const binaryFolder = getKubectlGadgetBinaryFolder(releaseTag);

   const binaryFilePath = path.join(
      binaryFolder,
      getKubectlGadgetExecutableFileName()
   );

   if (checkIfkubeGadgetBinaryExist(binaryFilePath)) {
      return {succeeded: true, result: binaryFilePath};
   }

   return await longRunning(`Downloading kubectl-gadget to ${binaryFilePath}.`, () => downloadKubectlGadget(binaryFilePath, releaseTag));
}

async function downloadKubectlGadget(binaryFilePath: string, releaseTag: string): Promise<Errorable<string>> {
   const downloadFolder = getDownloadFolder();
   const downloadFileName = await getKubectlGadgetTarFileName();
   const downloadFilePath = path.join(downloadFolder, downloadFileName);

   const kubectlgadgetDownloadUrl = `https://github.com/inspektor-gadget/inspektor-gadget/releases/download/${releaseTag}/${downloadFileName}`;

   const downloadResult = await download.once(kubectlgadgetDownloadUrl, downloadFilePath);
   if (failed(downloadResult)) {
      return {
         succeeded: false,
         error: `Failed to download kubectl-gadget binary from ${kubectlgadgetDownloadUrl}: ${downloadResult.error}`
      };
   }
   const decompress = require("decompress");

   try {
      await decompress(downloadFilePath, downloadFolder);
   } catch (error) {
      return {
         succeeded: false,
         error: `Failed to unzip kubectl-gadget binary ${downloadFilePath} to ${downloadFolder}: ${error}`
      };
   }

   // Remove zip.
   fs.unlinkSync(downloadFilePath);

   // Avoid `download.once()` thinking that the zip file is already downloaded the next time.
   // If there's any failure after this, we *want* it to be downloaded again.
   download.clear(downloadFilePath);

   // Move file to more flatten structure.
   const unzippedBinaryFilePath = getUnzippedKubectlGadgetFilePath(downloadFolder);
   await moveFile(unzippedBinaryFilePath, binaryFilePath);

   //If linux check -- make chmod 0755
   fs.chmodSync(path.join(binaryFilePath), '0755');
   return {succeeded: true, result: binaryFilePath};
}

function getUnzippedKubectlGadgetFilePath(unzippedFolder: string) {
   let architecture = os.arch();
   let operatingSystem = os.platform().toLocaleLowerCase();

   if (architecture === 'x64') {
      architecture = 'amd64';
   }

   if (operatingSystem === 'win32') {
      operatingSystem = 'windows';
   }

   const unzippedBinaryFilename = getKubectlGadgetExecutableFileName();
   return path.join(unzippedFolder, unzippedBinaryFilename);
}

async function getKubectlGadgetTarFileName() {
   let architecture = os.arch();
   let operatingSystem = os.platform().toLocaleLowerCase();
   const releaseTag = await getLatestKubectlGadgetReleaseTag();
   
   if (architecture === 'x64') {
      architecture = 'amd64';
   }

   if (operatingSystem === 'win32') {
      operatingSystem = 'win';
   }

   return `kubectl-gadget-${operatingSystem}-${architecture}-${releaseTag}.tar.gz`;
}

function getKubectlGadgetExecutableFileName() {
   const operatingSystem = os.platform().toLocaleLowerCase();
   const extension = operatingSystem === 'win32' ? '.exe' : '';
   return `kubectl-gadget${extension}`;
}