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
import { launchCommandInWorkspaceFolder } from "./commandUtils";

export class DraftDockerfilePanel extends BasePanel<"draftDockerfile"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftDockerfile", {
            pickLocationResponse: null,
            createDockerfileResponse: null,
        });
    }
}

export class DraftDockerfileDataProvider implements PanelDataProvider<"draftDockerfile"> {
    readonly draftDirectory: string;
    constructor(
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
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
            location: "",
            existingFiles: getExistingFiles(this.workspaceFolder, ""),
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"draftDockerfile"> {
        return {
            createDockerfileRequest: true,
            openFileRequest: false,
            pickLocationRequest: false,
            launchCommand: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickLocationRequest: (openFileOptions) => this.handlePickLocationRequest(openFileOptions, webview),
            createDockerfileRequest: (args) =>
                this.handleCreateDockerfileRequest(
                    args.language,
                    args.imageVersion,
                    args.builderVersion,
                    args.port,
                    args.location,
                    webview,
                ),
            openFileRequest: (filePath) => this.handleOpenFileRequest(filePath),
            launchCommand: (cmd) => launchCommandInWorkspaceFolder(cmd, this.workspaceFolder),
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

    private async handleCreateDockerfileRequest(
        language: string,
        imageVersion: string,
        builderVersion: string,
        port: number,
        location: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const variables = {
            PORT: port,
            VERSION: imageVersion,
            BUILDERVERSION: builderVersion,
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
