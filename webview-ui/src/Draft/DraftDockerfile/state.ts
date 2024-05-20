import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { LanguageInfo, LanguageVersionInfo } from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { Validatable, ValidatableValue, invalid, isValid, unset, valid } from "../../utilities/validation";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { ExistingFiles } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDockerfile";

const defaultPortNumber = 80;

export type EventDef = {
    setSelectedLanguage: Validatable<LanguageInfo>;
    setSelectedLanguageVersion: Validatable<string>;
    setSelectedPort: Validatable<number>;
    setCreating: void;
};

export type DraftDockerfileState = {
    workspaceConfig: WorkspaceFolderConfig;
    supportedLanguages: LanguageInfo[];
    existingFiles: ExistingFiles;
    status: Status;
    selectedLocation: ValidatableValue<string>;
    selectedLanguage: Validatable<LanguageInfo>;
    isBuilderImageRequired: boolean;
    selectedLanguageVersion: Validatable<string>;
    builderImageTag: Validatable<string>;
    runtimeImageTag: Validatable<string>;
    selectedPort: Validatable<number>;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"draftDockerfile", EventDef, DraftDockerfileState> = {
    createState: (initialState) => ({
        workspaceConfig: initialState.workspaceConfig,
        supportedLanguages: initialState.supportedLanguages,
        existingFiles: initialState.existingFiles,
        status: "Editing",
        selectedLocation: getValidatedLocation(initialState.location, initialState.existingFiles),
        selectedLanguage: unset(),
        isBuilderImageRequired: false,
        selectedLanguageVersion: unset(),
        builderImageTag: unset(),
        runtimeImageTag: unset(),
        selectedPort: valid(defaultPortNumber),
    }),
    vscodeMessageHandler: {
        pickLocationResponse: (state, response) => ({
            ...state,
            existingFiles: response.existingFiles,
            selectedLocation: getValidatedLocation(response.location, response.existingFiles),
        }),
        getLanguageVersionInfoResponse: (state, response) => ({
            ...state,
            ...getLanguageVersionState(state, response.language, response.versionInfo),
        }),
        createDockerfileResponse: (state, existingFiles) => ({
            ...state,
            existingFiles,
            status: "Created",
        }),
    },
    eventHandler: {
        setSelectedLanguage: (state, selectedLanguage) => ({
            ...state,
            selectedLanguage,
            isBuilderImageRequired: isValid(selectedLanguage) ? selectedLanguage.value.isBuilderImageRequired : false,
            selectedLanguageVersion: unset(),
            selectedPort: isValid(selectedLanguage)
                ? valid(selectedLanguage.value.defaultPort ?? defaultPortNumber)
                : valid(defaultPortNumber),
        }),
        setSelectedLanguageVersion: (state, selectedLanguageVersion) => ({
            ...state,
            selectedLanguageVersion,
        }),
        setSelectedPort: (state, selectedPort) => ({ ...state, selectedPort }),
        setCreating: (state) => ({ ...state, status: "Creating" }),
    },
};

export const vscode = getWebviewMessageContext<"draftDockerfile">({
    pickLocationRequest: null,
    getLanguageVersionInfoRequest: null,
    createDockerfileRequest: null,
    openFileRequest: null,
    launchDraftDeployment: null,
    launchDraftWorkflow: null,
});

type LanguageVersionState = Pick<DraftDockerfileState, "builderImageTag" | "runtimeImageTag">;

function getLanguageVersionState(
    state: DraftDockerfileState,
    language: string,
    versionInfo: LanguageVersionInfo,
): LanguageVersionState {
    if (!isValid(state.selectedLanguage) || language !== state.selectedLanguage.value.name) {
        // Keep the state unchanged.
        return {
            builderImageTag: state.builderImageTag,
            runtimeImageTag: state.runtimeImageTag,
        };
    }

    return {
        builderImageTag: versionInfo.builderImageTag ? valid(versionInfo.builderImageTag) : unset(),
        runtimeImageTag: valid(versionInfo.runtimeImageTag),
    };
}

function getValidatedLocation(location: string, existingFiles: ExistingFiles): ValidatableValue<string> {
    if (existingFiles.length === 0) return valid(location);
    return invalid(location, "Dockerfile or dockerignore already exist in the selected directory.");
}
