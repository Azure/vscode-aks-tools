import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { LanguageInfo } from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { Validatable, ValidatableValue, invalid, isValid, unset, valid } from "../../utilities/validation";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { ExistingFiles } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDockerfile";

const defaultPortNumber = 80;

export type EventDef = {
    setSelectedLanguage: Validatable<LanguageInfo>;
    setSelectedLanguageVersion: Validatable<string>;
    setBuilderImageTag: Validatable<string>;
    setRuntimeImageTag: Validatable<string>;
    setSelectedPort: Validatable<number>;
    setCreating: void;
};

export type DraftDockerfileState = {
    workspaceConfig: WorkspaceFolderConfig;
    location: ValidatableValue<string>;
    existingFiles: ExistingFiles;
    status: Status;
    selectedLanguage: Validatable<LanguageInfo>;
    selectedLanguageVersion: Validatable<string>;
    builderImageTag: Validatable<string> | null;
    runtimeImageTag: Validatable<string>;
    selectedPort: Validatable<number>;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"draftDockerfile", EventDef, DraftDockerfileState> = {
    createState: (initialState) => ({
        workspaceConfig: initialState.workspaceConfig,
        location: getValidatedLocation(initialState.location, initialState.existingFiles),
        existingFiles: initialState.existingFiles,
        status: "Editing",
        selectedLanguage: unset(),
        selectedLanguageVersion: unset(),
        builderImageTag: null,
        runtimeImageTag: unset(),
        selectedPort: valid(defaultPortNumber),
    }),
    vscodeMessageHandler: {
        pickLocationResponse: (state, response) => ({
            ...state,
            existingFiles: response.existingFiles,
            location: getValidatedLocation(response.location, response.existingFiles),
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
            ...getLanguageVersionState(selectedLanguage, unset()),
        }),
        setSelectedLanguageVersion: (state, selectedLanguageVersion) => ({
            ...state,
            ...getLanguageVersionState(state.selectedLanguage, selectedLanguageVersion),
        }),
        setBuilderImageTag: (state, builderImageTag) => ({ ...state, builderImageTag }),
        setRuntimeImageTag: (state, runtimeImageTag) => ({ ...state, runtimeImageTag }),
        setSelectedPort: (state, selectedPort) => ({ ...state, selectedPort }),
        setCreating: (state) => ({ ...state, status: "Creating" }),
    },
};

export const vscode = getWebviewMessageContext<"draftDockerfile">({
    pickLocationRequest: null,
    createDockerfileRequest: null,
    openFileRequest: null,
    launchCommand: null,
});

type LanguageVersionState = Pick<
    DraftDockerfileState,
    "selectedLanguageVersion" | "builderImageTag" | "runtimeImageTag" | "selectedPort"
>;

function getLanguageVersionState(
    language: Validatable<LanguageInfo>,
    languageVersion: Validatable<string>,
): LanguageVersionState {
    if (!isValid(language)) {
        return {
            selectedLanguageVersion: languageVersion,
            builderImageTag: null,
            runtimeImageTag: unset(),
            selectedPort: valid(defaultPortNumber),
        };
    }

    if (!isValid(languageVersion)) {
        return {
            selectedLanguageVersion: languageVersion,
            builderImageTag: language.value.getDefaultBuilderImageTag ? unset() : null,
            runtimeImageTag: unset(),
            selectedPort: valid(language.value.defaultPort ?? defaultPortNumber),
        };
    }

    return {
        selectedLanguageVersion: languageVersion,
        builderImageTag: language.value.getDefaultBuilderImageTag
            ? valid(language.value.getDefaultBuilderImageTag(languageVersion.value))
            : null,
        runtimeImageTag: valid(language.value.getDefaultRuntimeImageTag(languageVersion.value)),
        selectedPort: valid(language.value.defaultPort ?? defaultPortNumber),
    };
}

function getValidatedLocation(location: string, existingFiles: ExistingFiles): ValidatableValue<string> {
    if (existingFiles.length === 0) return valid(location);
    return invalid(location, "Dockerfile or dockerignore already exist in the selected directory.");
}
