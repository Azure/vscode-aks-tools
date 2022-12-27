import * as vscode from 'vscode';
import { Subscription } from '@azure/arm-subscriptions';
import { Environment } from '@azure/ms-rest-azure-env';
import { TokenCredential } from '@azure/core-auth';
import { Errorable } from './errorable';

export interface AzureAccountExtensionApi {
    readonly filters: AzureResourceFilter[];
    readonly sessions: AzureSession[];
    readonly subscriptions: AzureSubscription[];
}

export interface AzureResourceFilter {
    readonly session: AzureSession;
    readonly subscription: Subscription;
}

export interface AzureSession {
    readonly environment: Environment;
    readonly userId: string;
    readonly tenantId: string;
    readonly credentials2?: TokenCredential;
}

export interface AzureSubscription {
    readonly session: AzureSession;
    readonly subscription: Subscription;
}

export function getAzureAccountExtensionApi(): Errorable<AzureAccountExtensionApi> {
    const azureAccountExtension = vscode.extensions.getExtension('ms-vscode.azure-account');
    if (!azureAccountExtension) {
        return {succeeded: false, error: 'Azure extension not found.'};
    }

    return {succeeded: true, result: azureAccountExtension.exports.api};
}