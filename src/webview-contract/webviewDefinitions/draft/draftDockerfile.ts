import { WebviewDefinition } from "../../webviewTypes";
import { OpenFileOptions } from "../shared/fileSystemTypes";
import { WorkspaceFolderConfig } from "../shared/workspaceTypes";
import { VsCodeCommand } from "./types";

export interface InitialState {
    workspaceConfig: WorkspaceFolderConfig;
    location: string;
    existingFiles: ExistingFiles;
}

export type ExistingFiles = string[];

export type CreateParams = {
    language: string;
    builderImageTag: string | null;
    runtimeImageTag: string;
    port: number;
    location: string;
};

export type ToVsCodeMsgDef = {
    pickLocationRequest: OpenFileOptions;
    createDockerfileRequest: CreateParams;
    openFileRequest: string;
    launchCommand: VsCodeCommand;
};

export type ToWebViewMsgDef = {
    pickLocationResponse: {
        location: string;
        existingFiles: ExistingFiles;
    };
    createDockerfileResponse: ExistingFiles;
};

export type DraftDockerfileDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
