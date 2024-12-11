import { Uri, WorkspaceFolder, window } from "vscode";
import path from "path";
import * as fs from "fs";
import { BasePanel, PanelDataProvider } from "../BasePanel";
import {
    ExistingFiles,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../webview-contract/webviewDefinitions/draft/draftDockerfile";
import { TelemetryDefinition } from "../../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../../webview-contract/messaging";
import { ShellOptions, exec } from "../../commands/utils/shell";
import { failed } from "../../commands/utils/errorable";
import { OpenFileOptions } from "../../webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { launchDraftCommand } from "./commandUtils";
import { getLanguageVersionInfo, getSupportedLanguages } from "../../commands/draft/languages";

export class DraftDockerfilePanel extends BasePanel<"draftDockerfile"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftDockerfile", {
            pickLocationResponse: null,
            getLanguageVersionInfoResponse: null,
            createDockerfileResponse: null,
        });
    }
}

export class DraftDockerfileDataProvider implements PanelDataProvider<"draftDockerfile"> {
    readonly draftDirectory: string;
    constructor(
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
        readonly initialLocation: string,
    ) {
        this.draftDirectory = path.dirname(draftBinaryPath);
    }

    getTitle(): string {
        return `Draft Dockerfile in ${this.workspaceFolder.name}`;
    }

    getInitialState(): InitialState {
        return {
            workspaceConfig: {
                name: this.workspaceFolder.name,
                fullPath: this.workspaceFolder.uri.fsPath,
                pathSeparator: path.sep,
            },
            location: this.initialLocation,
            supportedLanguages: getSupportedLanguages(),
            existingFiles: getExistingFiles(this.workspaceFolder, this.initialLocation),
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"draftDockerfile"> {
        return {
            createDockerfileRequest: true,
            getLanguageVersionInfoRequest: false,
            openFileRequest: false,
            pickLocationRequest: false,
            launchDraftDeployment: false,
            launchDraftWorkflow: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickLocationRequest: (openFileOptions) => this.handlePickLocationRequest(openFileOptions, webview),
            getLanguageVersionInfoRequest: (args) =>
                this.handleGetLanguageVersionInfoRequest(args.language, args.version, webview),
            createDockerfileRequest: (args) =>
                this.handleCreateDockerfileRequest(
                    args.language,
                    args.builderImageTag,
                    args.runtimeImageTag,
                    args.port,
                    args.location,
                    webview,
                ),
            openFileRequest: (filePath) => this.handleOpenFileRequest(filePath),
            launchDraftDeployment: (args) =>
                launchDraftCommand("aks.draftDeployment", {
                    workspaceFolder: this.workspaceFolder,
                    initialLocation: args.initialLocation,
                    initialSelection: {
                        targetPort: args.initialTargetPort || undefined,
                    },
                }),
            launchDraftWorkflow: (args) =>
                launchDraftCommand("aks.draftWorkflow", {
                    workspaceFolder: this.workspaceFolder,
                    initialSelection: {
                        dockerfilePath: path.join(args.initialDockerfileLocation, "Dockerfile"),
                        dockerfileBuildContextPath: args.initialDockerfileLocation,
                    },
                }),
        };
    }

    private async handlePickLocationRequest(openFileOptions: OpenFileOptions, webview: MessageSink<ToWebViewMsgDef>) {
        const result = await window.showOpenDialog({
            canSelectFiles: openFileOptions.type === "file",
            canSelectFolders: openFileOptions.type === "directory",
            canSelectMany: false,
            defaultUri: openFileOptions.defaultPath ? Uri.file(openFileOptions.defaultPath) : undefined,
        });

        if (!result || result.length === 0) return;

        const location = path.relative(this.workspaceFolder.uri.fsPath, result[0].fsPath);
        webview.postPickLocationResponse({
            location,
            existingFiles: getExistingFiles(this.workspaceFolder, location),
        });
    }

    private handleGetLanguageVersionInfoRequest(
        language: string,
        version: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const versionInfo = getLanguageVersionInfo(language, version);
        webview.postGetLanguageVersionInfoResponse({ language, versionInfo });
    }

    private async handleCreateDockerfileRequest(
        language: string,
        builderImageTag: string | null,
        runtimeImageTag: string,
        port: number,
        location: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const variables = {
            PORT: port,
            VERSION: runtimeImageTag,
            BUILDERVERSION: builderImageTag,
        };

        const variableArgs = Object.entries(variables)
            .map(([key, value]) => `--variable ${key}=${value}`)
            .join(" ");
        const command = `draft create --language ${language} --dockerfile-only ${variableArgs} --destination .${path.sep}${location}`;

        const execOptions: ShellOptions = {
            workingDir: this.workspaceFolder.uri.fsPath,
            envPaths: [this.draftDirectory],
        };

        const draftResult = await exec(command, execOptions);
        if (failed(draftResult)) {
            window.showErrorMessage(draftResult.error);
            return;
        }

        const existingFiles = getExistingFiles(this.workspaceFolder, location);
        webview.postCreateDockerfileResponse(existingFiles);
    }

    private handleOpenFileRequest(relativeFilePath: string) {
        const filePath = path.join(this.workspaceFolder.uri.fsPath, relativeFilePath);
        window.showTextDocument(Uri.file(filePath));
    }
}

function getExistingFiles(workspaceFolder: WorkspaceFolder, location: string): ExistingFiles {
    const locationFullPath = path.join(workspaceFolder.uri.fsPath, location);
    const dockerfilePath = path.join(locationFullPath, "Dockerfile");
    const dockerignorePath = path.join(locationFullPath, ".dockerignore");
    const existingFiles = [dockerfilePath, dockerignorePath]
        .filter((p) => fs.existsSync(p))
        .map((p) => path.relative(workspaceFolder.uri.fsPath, p));
    return existingFiles;
}
