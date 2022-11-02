import * as vscode from 'vscode';
import { combine, failed, Errorable } from './errorable';
import { KustomizeConfig } from '../periscope/models/kustomizeConfig';
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
