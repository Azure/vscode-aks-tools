import { WebviewDefinition } from "../../webviewTypes";
import { OpenFileOptions } from "../shared/fileSystemTypes";
import { WorkspaceFolderConfig } from "../shared/workspaceTypes";
import { LanguageInfo, LanguageVersionInfo } from "./types";

export interface InitialState {
    workspaceConfig: WorkspaceFolderConfig;
    location: string;
    supportedLanguages: LanguageInfo[];
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
    getLanguageVersionInfoRequest: {
        language: string;
        version: string;
    };
    createDockerfileRequest: CreateParams;
    openFileRequest: string;
    launchDraftDeployment: {
        initialTargetPort: number | null;
        initialLocation: string;
    };
    launchDraftWorkflow: {
        initialDockerfileLocation: string;
    };
};

export type ToWebViewMsgDef = {
    pickLocationResponse: {
        location: string;
        existingFiles: ExistingFiles;
    };
    getLanguageVersionInfoResponse: {
        language: string;
        versionInfo: LanguageVersionInfo;
    };
    createDockerfileResponse: ExistingFiles;
};

export type DraftDockerfileDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
