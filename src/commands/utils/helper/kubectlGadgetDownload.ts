import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getKubectlGadgetConfig } from '../config';
import { Errorable, failed } from '../errorable';
import { longRunning } from '../host';
import { downloadBinary, getBinaryExecutableFileName } from './binaryDownloadHelper';

const GADGET_BINARY_NAME: string = "kubectl-gadget";

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
      getBinaryExecutableFileName(GADGET_BINARY_NAME)
   );

   if (checkIfkubeGadgetBinaryExist(binaryFilePath)) {
      return {succeeded: true, result: binaryFilePath};
   }

   return await longRunning(`Downloading kubectl-gadget to ${binaryFilePath}.`, () => downloadKubectlGadget(binaryFilePath, releaseTag));
}

async function downloadKubectlGadget(
   binaryFilePath: string, 
   releaseTag: string
   ): Promise<Errorable<string>> {
   const downloadFolder = getDownloadFolder();
   const downloadFileName = await getKubectlGadgetTarFileName();

   const kubectlgadgetDownloadUrl = `https://github.com/inspektor-gadget/inspektor-gadget/releases/download/${releaseTag}/${downloadFileName}`;

   const binaryFileDownloadResult = await downloadBinary(binaryFilePath, GADGET_BINARY_NAME, downloadFolder, kubectlgadgetDownloadUrl, downloadFileName);
   return binaryFileDownloadResult;
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
