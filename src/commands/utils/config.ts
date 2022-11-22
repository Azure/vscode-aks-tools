import * as vscode from 'vscode';
import { combine, failed, Errorable } from './errorable';
import { KubeloginConfig, KustomizeConfig } from '../periscope/models/config';
import * as semver from "semver";

export function getKustomizeConfig(): Errorable<KustomizeConfig> {
    const periscopeConfig = vscode.workspace.getConfiguration('aks.periscope');
    const props = combine([
        getConfigValue(periscopeConfig, 'repoOrg'),
        getConfigValue(periscopeConfig, 'containerRegistry'),
        getConfigValue(periscopeConfig, 'releaseTag'),
        getConfigValue(periscopeConfig, 'imageVersion')
    ]);

    if (failed(props)) {
        return { succeeded: false, error: `Failed to read aks.periscope configuration: ${props.error}` };
    }

    const config = {
        repoOrg: props.result[0],
        containerRegistry: props.result[1],
        releaseTag: props.result[2],
        imageVersion: props.result[3]
    }

    const minimumSupportedVersion = "0.0.11";
    if (semver.parse(config.imageVersion) && semver.lt(config.imageVersion, minimumSupportedVersion)) {
        config.imageVersion = minimumSupportedVersion;
    }

    if (semver.parse(config.releaseTag) && semver.lt(config.releaseTag, minimumSupportedVersion)) {
        config.releaseTag = minimumSupportedVersion;
    }

    return { succeeded: true, result: config };
}

export function getKubeloginConfig(): Errorable<KubeloginConfig> {
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
 
function getConfigValue(config: vscode.WorkspaceConfiguration, key: string): Errorable<string> {
    const value = config.get(key);
    if (value === undefined) {
        return { succeeded: false, error: `${key} not defined.` }
    }
    const result = value as string;
    if (result === undefined) {
        return { succeeded: false, error: `${key} value has type: ${typeof value}; expected string.` }
    }
    return { succeeded: true, result: result };
}
