import { WebviewDefinition } from "../../webviewTypes";
import { OpenFileOptions } from "../shared/fileSystemTypes";
import { WorkspaceFolderConfig } from "../shared/workspaceTypes";

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
    createDockerfileResponse: ExistingFiles;
};

export type DraftDockerfileDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
