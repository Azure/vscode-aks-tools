import { MessageHandler, MessageSink } from "../../../../src/webview-contract/messaging";
import {
    CreateParams,
    ExistingFiles,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../../src/webview-contract/webviewDefinitions/draft/draftDockerfile";
import { VsCodeCommand } from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { OpenFileOptions } from "../../../../src/webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { DraftDockerfile } from "../../Draft";
import { stateUpdater } from "../../Draft/DraftDockerfile/state";
import { filterNulls } from "../../utilities/array";
import { Scenario } from "../../utilities/manualTest";
import { delay } from "../../utilities/time";
import { FilePickerWrapper } from "../components/FilePickerWrapper";
import { TestDialogEvents } from "../utilities/testDialogEvents";
import {
    Directory,
    addFileSystemItem,
    asPathParts,
    asPathString,
    findFileSystemItem,
    fromFindOutput,
    getRelativePath,
} from "../utilities/testFileSystemUtils";
import { aksStoreDemoFiles } from "./testData/fileSystemData";

const workspaceConfig: WorkspaceFolderConfig = {
    fullPath: "/code/aks-store-demo",
    name: "aks-store-demo",
    pathSeparator: "/",
};

const rootDir = fromFindOutput(aksStoreDemoFiles, workspaceConfig.fullPath);

export function getDraftDockerfileScenarios() {
    const initialState: InitialState = {
        workspaceConfig,
        location: getRelativePath(asPathString(rootDir), "/code/aks-store-demo"),
        existingFiles: getExistingFiles(rootDir, "/code/aks-store-demo"),
    };

    function getMessageHandler(
        webview: MessageSink<ToWebViewMsgDef>,
        dialogEvents: TestDialogEvents,
    ): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickLocationRequest: handlePickLocationRequest,
            createDockerfileRequest: handleCreateDockerfileRequest,
            openFileRequest: handleOpenFileRequest,
            launchCommand: (cmd) => alert(`Launching command ${VsCodeCommand[cmd]}`),
        };

        async function handleCreateDockerfileRequest(createParams: CreateParams) {
            await delay(500);
            alert(`Creating Dockerfile with params:\n${JSON.stringify(createParams, null, 2)}`);
            const locationPath = [...rootDir.path, rootDir.name, ...asPathParts(createParams.location)];
            addFileSystemItem(rootDir, [...locationPath, "Dockerfile"], "file");
            addFileSystemItem(rootDir, [...locationPath, ".dockerignore"], "file");
            webview.postCreateDockerfileResponse(getExistingFiles(rootDir, locationPath.join("/")));
        }

        async function handlePickLocationRequest(options: OpenFileOptions) {
            const result = await dialogEvents.openFile(options);
            if (result) {
                webview.postPickLocationResponse({
                    location: getRelativePath(asPathString(rootDir), result.paths[0]),
                    existingFiles: getExistingFiles(rootDir, result.paths[0]),
                });
            }
        }

        async function handleOpenFileRequest(relativePath: string) {
            alert(`Opening ${relativePath}`);
        }
    }

    const dialogEvents = new TestDialogEvents();
    return [
        Scenario.create(
            "draftDockerfile",
            "",
            () => (
                <FilePickerWrapper events={dialogEvents} rootDir={rootDir}>
                    <DraftDockerfile {...initialState} />
                </FilePickerWrapper>
            ),
            (webview) => getMessageHandler(webview, dialogEvents),
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}

function getExistingFiles(workspaceDirectory: Directory, locationFullPath: string): ExistingFiles {
    const paths = ["Dockerfile", ".dockerignore"].map(existingPathRelativeToWorkspace);
    return filterNulls(paths);

    function existingPathRelativeToWorkspace(pathRelativeToLocation: string): string | null {
        const pathParts = asPathParts(`${locationFullPath}/${pathRelativeToLocation}`);
        const existingItem = findFileSystemItem(workspaceDirectory, pathParts);
        return existingItem ? getRelativePath(asPathString(workspaceDirectory), asPathString(existingItem)) : null;
    }
}
