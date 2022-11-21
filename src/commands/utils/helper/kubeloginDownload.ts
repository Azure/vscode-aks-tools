import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as download from '../download/download';
import * as path from 'path';
import { combine, Errorable, failed } from '../errorable';
import { moveFile } from 'move-file';

let kubeloginBinaryPath: string;

interface KubeloginConfig {
    releaseTag: string;
 }

function baseInstallFolder(): string {
   return path.join(os.homedir(), `.vs-kubernetes/tools`);
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
   const latestReleaseTag = await getLatestKubeloginReleaseTag();

   if (!latestReleaseTag) {
      return {succeeded: false, error: "Could not get latest release tag."};
   }

   const kubeloginBinaryFile = getKubeloginFileName();
   const kubeloginPath = path.join(baseInstallFolder(), "kubelogin");
   kubeloginBinaryPath = path.join(kubeloginPath, latestReleaseTag, "kubelogin");

   // example latest release location: https://github.com/Azure/kubelogin/releases/tag/v0.0.20
   const destinationFile = path.join(
      kubeloginPath,
      kubeloginBinaryFile
   );

   if (checkIfKubeloginBinaryExist(destinationFile)) {
      return {succeeded: true, result: kubeloginBinaryPath};
   }

   const kubeloginDownloadUrl = `https://github.com/Azure/kubelogin/releases/download/${latestReleaseTag}/${kubeloginBinaryFile}.zip`;
   const downloadResult = await download.once(
      kubeloginDownloadUrl,
      destinationFile
   );

   if (failed(downloadResult)) {
      return {
         succeeded: false,
         error: `Failed to download kubelogin binary: ${downloadResult.error}`
      };
   }
   const decompress = require("decompress");

   await decompress(destinationFile, kubeloginPath)
    .then(async () => {
      // Remove zip.
      var fs = require('fs');
      var filePath = destinationFile; 
      fs.unlinkSync(filePath);

      // Move file to more flatten structure.
      await moveKubeloginToFlatDirStruct();
    })
    .catch((error: any) => {
        return {
            succeeded: false,
            error: `Failed to unzip kubelogin binary: ${error}`
         };
    });

   //If linux check -- make chmod 0755
   fs.chmodSync(path.join(kubeloginBinaryPath), '0755');
   return {succeeded: true, result: kubeloginBinaryPath};
}

async function moveKubeloginToFlatDirStruct(){
   let architecture = os.arch();
   const operatingSystem = os.platform().toLocaleLowerCase();

   if (architecture === 'x64') {
      architecture = 'amd64';
   }
   const kubeloginPath = path.join(baseInstallFolder(), "kubelogin");

   const oldPath = path.join(kubeloginPath, "bin", `${operatingSystem}_${architecture}`, "kubelogin");
   const newPath = path.join(kubeloginBinaryPath);

   await moveFile(oldPath, newPath);
}

function getKubeloginFileName() {
   let architecture = os.arch();
   const operatingSystem = os.platform().toLocaleLowerCase();

   if (architecture === 'x64') {
      architecture = 'amd64';
   }
   let kubeloginBinaryFile = `kubelogin-${operatingSystem}-${architecture}`;

   if (operatingSystem === 'win32') {
      // Kubelogin release v0.0.22 the file name has exe associated with it.
      kubeloginBinaryFile = `kubelogin-${operatingSystem}-${architecture}.exe`;
   }

   return kubeloginBinaryFile;
}

function getKubeloginConfig(): Errorable<KubeloginConfig> {
   const kubeloginConfig = vscode.workspace.getConfiguration('azure.kubelogin');
   const props = combine([getConfigValue(kubeloginConfig, 'releaseTag')]);

   if (failed(props)) {
      return {
         succeeded: false,
         error: `Failed to readazure.kubelogin configuration: ${props.error}`
      };
   }

   const config = {
      releaseTag: props.result[0]
   };

   return {succeeded: true, result: config};
}

function getConfigValue(
   config: vscode.WorkspaceConfiguration,
   key: string
): Errorable<string> {
   const value = config.get(key);
   if (value === undefined) {
      return {succeeded: false, error: `${key} not defined.`};
   }
   const result = value as string;
   if (result === undefined) {
      return {
         succeeded: false,
         error: `${key} value has type: ${typeof value}; expected string.`
      };
   }
   return {succeeded: true, result: result};
}
