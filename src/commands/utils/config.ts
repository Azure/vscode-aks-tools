import * as vscode from 'vscode';
import { combine, failed, Errorable } from './errorable';
import { KubeloginConfig, KustomizeConfig } from '../periscope/models/config';
import * as semver from "semver";
import { CommandCategory, PresetCommand } from '../../webview-contract/webviewDefinitions/kubectl';

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
    const config = getConfigValue(kubeloginConfig, 'releaseTag');

    if (failed(config)) {
        return {
            succeeded: false,
            error: `Failed to read azure.kubelogin configuration: ${config.error}`
        };
    }

    const configresult = {
        releaseTag: config.result
    };

    return { succeeded: true, result: configresult };
}

export function getKubectlGadgetConfig(): Errorable<KubeloginConfig> {
    const kubectlGadgetConfig = vscode.workspace.getConfiguration('azure.kubectlgadget');
    const config = getConfigValue(kubectlGadgetConfig, 'releaseTag');

    if (failed(config)) {
        return {
            succeeded: false,
            error: `Failed to read azure.kubectlgadget configuration: ${config.error}`
        };
    }

    const configresult = {
        releaseTag: config.result
    };

    return { succeeded: true, result: configresult };
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

export function getKubectlCustomCommands(): PresetCommand[] {
    const config = vscode.workspace.getConfiguration('azure.customkubectl');
    const value = config.get('commands');
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isCommand).map(item => ({...item, category: CommandCategory.Custom}));

    function isCommand(value: any): value is PresetCommand {
        return (value.constructor.name === 'Object') && (value as PresetCommand).command && (value as PresetCommand).name ? true : false;
    }
}

export async function addKubectlCustomCommand(name: string, command: string) {
    const currentCommands = getKubectlCustomCommands().map(cmd => ({name: cmd.name, command: cmd.command}));
    const commands = [...currentCommands, {name, command}].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    await vscode.workspace.getConfiguration().update('azure.customkubectl.commands', commands, vscode.ConfigurationTarget.Global, true);
}

export async function deleteKubectlCustomCommand(name: string) {
    const currentCommands = getKubectlCustomCommands().map(cmd => ({name: cmd.name, command: cmd.command}));
    const commands = currentCommands.filter(cmd => cmd.name !== name);
    await vscode.workspace.getConfiguration().update('azure.customkubectl.commands', commands, vscode.ConfigurationTarget.Global, true);
}