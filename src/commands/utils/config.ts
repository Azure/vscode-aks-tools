import * as vscode from "vscode";
import { combine, failed, Errorable } from "./errorable";
import { KubeloginConfig, KustomizeConfig } from "../periscope/models/config";
import * as semver from "semver";
import { CommandCategory, PresetCommand } from "../../webview-contract/webviewDefinitions/kubectl";
import { RetinaDownloadConfig } from "../periscope/models/RetinaDownloadConfig";
import { isObject } from "./runtimeTypes";
import { Environment, EnvironmentParameters } from "@azure/ms-rest-azure-env";

export function getConfiguredAzureEnv(): Environment {
    // See:
    // https://github.com/microsoft/vscode/blob/eac16e9b63a11885b538db3e0b533a02a2fb8143/extensions/microsoft-authentication/package.json#L40-L99
    const section = "microsoft-sovereign-cloud";
    const settingName = "environment";
    const authProviderConfig = vscode.workspace.getConfiguration(section);
    const environmentSettingValue = authProviderConfig.get<string | undefined>(settingName);

    if (environmentSettingValue === "ChinaCloud") {
        return Environment.ChinaCloud;
    } else if (environmentSettingValue === "USGovernment") {
        return Environment.USGovernment;
    } else if (environmentSettingValue === "custom") {
        const customCloud = authProviderConfig.get<EnvironmentParameters | undefined>("customEnvironment");
        if (customCloud) {
            return new Environment(customCloud);
        }

        throw new Error(
            `The custom cloud choice is not configured. Please configure the setting ${section}.${settingName}.`,
        );
    }

    return Environment.get(Environment.AzureCloud.name);
}

export interface SubscriptionFilter {
    tenantId: string;
    subscriptionId: string;
}

const onFilteredSubscriptionsChangeEmitter = new vscode.EventEmitter<void>();

export function getFilteredSubscriptionsChangeEvent() {
    return onFilteredSubscriptionsChangeEmitter.event;
}

export function getFilteredSubscriptions(): SubscriptionFilter[] {
    try {
        let values = vscode.workspace.getConfiguration("aks").get<string[]>("selectedSubscriptions", []);
        if (values.length === 0) {
            // Get filters from the Azure Account extension if the AKS extension has none.
            values = vscode.workspace.getConfiguration("azure").get<string[]>("resourceFilter", []);
        }
        return values.map(asSubscriptionFilter).filter((v) => v !== null) as SubscriptionFilter[];
    } catch {
        return [];
    }
}

function asSubscriptionFilter(value: string): SubscriptionFilter | null {
    try {
        const parts = value.split("/");
        return { tenantId: parts[0], subscriptionId: parts[1] };
    } catch {
        return null;
    }
}

export async function setFilteredSubscriptions(filters: SubscriptionFilter[]): Promise<void> {
    const existingFilters = getFilteredSubscriptions();
    const filtersChanged =
        existingFilters.length !== filters.length ||
        !filters.every((f) => existingFilters.some((ef) => ef.subscriptionId === f.subscriptionId));

    const values = filters.map((f) => `${f.tenantId}/${f.subscriptionId}`).sort();

    if (filtersChanged) {
        await vscode.workspace
            .getConfiguration("aks")
            .update("selectedSubscriptions", values, vscode.ConfigurationTarget.Global, true);
        onFilteredSubscriptionsChangeEmitter.fire();
    }
}

export function getKustomizeConfig(): Errorable<KustomizeConfig> {
    const periscopeConfig = vscode.workspace.getConfiguration("aks.periscope");
    const props = combine([
        getConfigValue(periscopeConfig, "repoOrg"),
        getConfigValue(periscopeConfig, "containerRegistry"),
        getConfigValue(periscopeConfig, "releaseTag"),
        getConfigValue(periscopeConfig, "imageVersion"),
    ]);

    if (failed(props)) {
        return { succeeded: false, error: `Failed to read aks.periscope configuration: ${props.error}` };
    }

    const config = {
        repoOrg: props.result[0],
        containerRegistry: props.result[1],
        releaseTag: props.result[2],
        imageVersion: props.result[3],
    };

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
    const kubeloginConfig = vscode.workspace.getConfiguration("azure.kubelogin");
    const config = getConfigValue(kubeloginConfig, "releaseTag");

    if (failed(config)) {
        return {
            succeeded: false,
            error: `Failed to read azure.kubelogin configuration: ${config.error}`,
        };
    }

    const configresult = {
        releaseTag: config.result,
    };

    return { succeeded: true, result: configresult };
}

export function getKubectlGadgetConfig(): Errorable<KubeloginConfig> {
    const kubectlGadgetConfig = vscode.workspace.getConfiguration("azure.kubectlgadget");
    const config = getConfigValue(kubectlGadgetConfig, "releaseTag");

    if (failed(config)) {
        return {
            succeeded: false,
            error: `Failed to read azure.kubectlgadget configuration: ${config.error}`,
        };
    }

    const configresult = {
        releaseTag: config.result,
    };

    return { succeeded: true, result: configresult };
}

export function getDraftConfig(): Errorable<RetinaDownloadConfig> {
    const draftConfig = vscode.workspace.getConfiguration("aks.drafttool");
    const props = getConfigValue(draftConfig, "releaseTag");

    if (failed(props)) {
        return {
            succeeded: false,
            error: `Failed to read aks.draft configuration: ${props.error}`,
        };
    }

    const config = {
        releaseTag: props.result,
    };

    return { succeeded: true, result: config };
}

export function getRetinaConfig(): Errorable<RetinaDownloadConfig> {
    const retinaconfig = vscode.workspace.getConfiguration("aks.retinatool");
    const props = getConfigValue(retinaconfig, "releaseTag");

    if (failed(props)) {
        return {
            succeeded: false,
            error: `Failed to read aks.retina configuration: ${props.error}`,
        };
    }

    const config = {
        releaseTag: props.result,
    };

    return { succeeded: true, result: config };
}

function getConfigValue(config: vscode.WorkspaceConfiguration, key: string): Errorable<string> {
    const value = config.get(key);
    if (value === undefined) {
        return { succeeded: false, error: `${key} not defined.` };
    }
    const result = value as string;
    if (result === undefined) {
        return { succeeded: false, error: `${key} value has type: ${typeof value}; expected string.` };
    }
    return { succeeded: true, result: result };
}

export function getKubectlCustomCommands(): PresetCommand[] {
    const config = vscode.workspace.getConfiguration("azure.customkubectl");
    const value = config.get("commands");
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isCommand).map((item) => ({ ...item, category: CommandCategory.Custom }));

    function isCommand(value: unknown): value is PresetCommand {
        return isObject(value) && "command" in value && "name" in value;
    }
}

export async function addKubectlCustomCommand(name: string, command: string) {
    const currentCommands = getKubectlCustomCommands().map((cmd) => ({ name: cmd.name, command: cmd.command }));
    const commands = [...currentCommands, { name, command }].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    await vscode.workspace
        .getConfiguration()
        .update("azure.customkubectl.commands", commands, vscode.ConfigurationTarget.Global, true);
}

export async function deleteKubectlCustomCommand(name: string) {
    const currentCommands = getKubectlCustomCommands().map((cmd) => ({ name: cmd.name, command: cmd.command }));
    const commands = currentCommands.filter((cmd) => cmd.name !== name);
    await vscode.workspace
        .getConfiguration()
        .update("azure.customkubectl.commands", commands, vscode.ConfigurationTarget.Global, true);
}
