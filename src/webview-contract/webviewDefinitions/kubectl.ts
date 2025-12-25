import { WebviewDefinition } from "../webviewTypes";

export enum CommandCategory {
    Resources,
    Health,
    Custom,
}

const presetCommandItems: [string, string, CommandCategory][] = [
    ["Get All Pods", "get pods --all-namespaces", CommandCategory.Resources],
    ["Get Cluster Info", "cluster-info", CommandCategory.Resources],
    ["Get API Resources", "api-resources", CommandCategory.Resources],
    ["Get Nodes", "get node", CommandCategory.Resources],
    ["Describe Services", "describe services", CommandCategory.Resources],
    ["Get All Events", "get events --all-namespaces", CommandCategory.Health],
    ["Healthz Check", "get --raw /healthz?verbose", CommandCategory.Health],
    ["Livez Check", "get --raw /livez?verbose", CommandCategory.Health],
    ["Readyz Check", "get --raw /readyz?verbose", CommandCategory.Health],
];

export const presetCommands: PresetCommand[] = presetCommandItems.map((cmd) => ({
    name: cmd[0],
    command: cmd[1],
    category: cmd[2],
}));

export interface PresetCommand {
    name: string;
    command: string;
    category: CommandCategory;
}

export interface InitialState {
    clusterName: string;
    customCommands: PresetCommand[];
    initialCommand?: string;
}

export type ToVsCodeMsgDef = {
    runCommandRequest: {
        command: string;
    };
    addCustomCommandRequest: {
        name: string;
        command: string;
    };
    deleteCustomCommandRequest: {
        name: string;
    };
    initialCommandRequest: {
        initialCommand: string;
    };
};

export type ToWebViewMsgDef = {
    runCommandResponse: {
        output: string | null;
        errorMessage: string | null;
    };
};

export type KubectlDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
