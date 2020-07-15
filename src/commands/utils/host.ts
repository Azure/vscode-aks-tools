import * as vscode from 'vscode';

const meta = require('../../../package.json');

export async function longRunning<T>(title: string, action: () => Promise<T>): Promise<T> {
  const options = {
    location: vscode.ProgressLocation.Notification,
    title: title
  };
  return await vscode.window.withProgress(options, (_) => action());
}

export function getExtensionPath(): string | undefined {
  const publisherName = `${meta.publisher}.${meta.name}`;
  const vscodeExtensionPath = vscode.extensions.getExtension(publisherName)?.extensionPath;

  if (!vscodeExtensionPath) {
    vscode.window.showInformationMessage('No Extension path found.');
    return;
  }
  return vscodeExtensionPath;
}

export function getSASKey(
  storageAccount: string,
  storageKey: string,
  generateSevenDaySas = false
) {
  const storage = require("azure-storage");
  const startDate = new Date();
  const expiryDate = new Date();

  startDate.setTime(startDate.getTime() - 5 * 60);
  let defaultExpirationTime = expiryDate.getTime() + 2 * 24 * 60 * 60 * 1000;

  if (generateSevenDaySas) {
    defaultExpirationTime = expiryDate.getTime() + 7 * 24 * 60 * 60 * 1000;
  }
  expiryDate.setTime(defaultExpirationTime);

  const AccountSasConstants = storage.Constants.AccountSasConstants;
  const sharedAccessPolicy = {
    AccessPolicy: {
      Services: AccountSasConstants.Services.BLOB,
      ResourceTypes: AccountSasConstants.Resources.SERVICE +
        AccountSasConstants.Resources.CONTAINER +
        AccountSasConstants.Resources.OBJECT,
      Permissions: AccountSasConstants.Permissions.READ +
        AccountSasConstants.Permissions.ADD +
        AccountSasConstants.Permissions.CREATE +
        AccountSasConstants.Permissions.WRITE +
        AccountSasConstants.Permissions.DELETE +
        AccountSasConstants.Permissions.LIST +
        AccountSasConstants.Permissions.UPDATE +
        AccountSasConstants.Permissions.PROCESS,
      Start: startDate,
      Expiry: expiryDate
    }
  };

  // Generate SAS.
  const sas = "?" + storage.generateAccountSharedAccessSignature(storageAccount, storageKey, sharedAccessPolicy);

  return sas;
}