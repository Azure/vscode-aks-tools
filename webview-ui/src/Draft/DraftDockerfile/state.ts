import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { LanguageInfo, LanguageVersionInfo } from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { Validatable, ValidatableValue, invalid, isValid, unset, valid } from "../../utilities/validation";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { ExistingFiles } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDockerfile";

const defaultPortNumber = 80;

export type EventDef = {
    setSelectedLanguage: Validatable<LanguageInfo>;
    setSelectedLanguageVersion: Validatable<LanguageVersionInfo>;
    setSelectedPort: Validatable<number>;
    setCreating: void;
};

export type DraftDockerfileState = {
    workspaceConfig: WorkspaceFolderConfig;
    location: ValidatableValue<string>;
    existingFiles: ExistingFiles;
    status: Status;
    selectedLanguage: Validatable<LanguageInfo>;
    selectedLanguageVersion: Validatable<LanguageVersionInfo>;
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
            selectedLanguageVersion: getDefaultLanguageVersion(selectedLanguage),
            selectedPort: getDefaultPort(selectedLanguage),
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
    createDockerfileRequest: null,
    openFileRequest: null,
    launchCommand: null,
});

function getDefaultLanguageVersion(language: Validatable<LanguageInfo>): Validatable<LanguageVersionInfo> {
    if (!isValid(language)) return unset();
    if (language.value.versions.length !== 1) return unset();
    return valid(language.value.versions[0]);
}

function getDefaultPort(language: Validatable<LanguageInfo>): Validatable<number> {
    if (!isValid(language)) return valid(defaultPortNumber);
    return valid(language.value.defaultPort ?? defaultPortNumber);
}

function getValidatedLocation(location: string, existingFiles: ExistingFiles): ValidatableValue<string> {
    if (existingFiles.length === 0) return valid(location);
    return invalid(location, "Dockerfile or dockerignore already exist in the selected directory.");
}
