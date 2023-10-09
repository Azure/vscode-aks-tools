import { WebviewDefinition } from "../webviewTypes";

export enum CommandCategory {
    Resources,
    Health,
    Custom
}

const presetCommandItems: [string, string, CommandCategory][] = [
    ["Get All nodes", "get nodes --output wide", CommandCategory.Resources]
];

export const tcpPresetCommands: TCPPresetCommand[] = presetCommandItems.map(cmd => ({
    name: cmd[0],
    command: cmd[1],
    category: cmd[2]
}));

export interface TCPPresetCommand {
    name: string,
    command: string
    category: CommandCategory
}

export interface InitialState {
    clusterName: string,
    customCommands: TCPPresetCommand[]
}

export type ToVsCodeMsgDef = {
    runCommandRequest: {
        command: string
    },
    addCustomCommandRequest: {
        name: string,
        command: string
    },
    deleteCustomCommandRequest: {
        name: string
    }
};

export type ToWebViewMsgDef = {
    runCommandResponse: {
        output: string | null
        errorMessage: string | null
    }
};

export type KubectlDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
