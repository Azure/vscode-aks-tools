import { FormEvent } from "react";
import { CreateParams, InitialState } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDockerfile";
import { ResourceSelector } from "../../components/ResourceSelector";
import { useStateManagement } from "../../utilities/state";
import styles from "../Draft.module.css";
import { stateUpdater, vscode } from "./state";
import { VSCodeButton, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFolder } from "@fortawesome/free-regular-svg-icons";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { getSupportedLanguages } from "../data";
import { Maybe, isNothing, just, nothing } from "../../utilities/maybe";
import { LanguageInfo, VsCodeCommand } from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import {
    Validatable,
    hasMessage,
    invalid,
    isValid,
    isValueSet,
    missing,
    orDefault,
    toNullable,
    valid,
} from "../../utilities/validation";
import { TextWithDropdown } from "../../components/TextWithDropdown";

type ChangeEvent = Event | FormEvent<HTMLElement>;

const supportedLanguages = getSupportedLanguages();

export function DraftDockerfile(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    function handleLanguageChange(language: LanguageInfo | null) {
        const validated = language === null ? missing<LanguageInfo>("Language is required.") : valid(language);
        eventHandlers.onSetSelectedLanguage(validated);
    }

    function handleLanguageVersionChange(versionName: string | null) {
        const validated = getValidatedLanguageVersion(versionName);
        eventHandlers.onSetSelectedLanguageVersion(validated);

        function getValidatedLanguageVersion(version: string | null): Validatable<string> {
            if (version === null || version === "" || version.trim() === "") {
                return missing("Language version is required.");
            }

            return valid(version);
        }
    }

    function handleBuilderImageTagChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLInputElement;
        const validated = getValidatedBuilderImageTag(elem.value);
        eventHandlers.onSetBuilderImageTag(validated);

        function getValidatedBuilderImageTag(builderImageTag: string): Validatable<string> {
            if (builderImageTag === "") {
                return missing("Builder image tag is required.");
            }

            return valid(builderImageTag);
        }
    }

    function handleRuntimeImageTagChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLInputElement;
        const validated = getValidatedRuntimeImageTag(elem.value);
        eventHandlers.onSetRuntimeImageTag(validated);

        function getValidatedRuntimeImageTag(runtimeImage: string): Validatable<string> {
            if (runtimeImage === "") {
                return missing("Runtime image tag is required.");
            }

            return valid(runtimeImage);
        }
    }

    function handlePortChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLInputElement;
        const port = parseInt(elem.value);
        const validated = getValidatedPort(port);
        eventHandlers.onSetSelectedPort(validated);

        function getValidatedPort(port: number): Validatable<number> {
            if (Number.isNaN(port)) {
                return invalid(port, "Port must be a number.");
            }
            if (port < 1 || port > 65535) {
                return invalid(port, "Port number must be between 1 and 65535.");
            }

            return valid(port);
        }
    }

    function handleChooseLocationClick() {
        vscode.postPickLocationRequest({
            defaultPath: state.workspaceConfig.fullPath,
            type: "directory",
            title: "Location to save Dockerfile",
            buttonLabel: "Select",
        });
    }

    function validate(): Maybe<CreateParams> {
        if (!isValid(state.location)) return nothing();
        if (!isValid(state.selectedLanguage)) return nothing();
        if (!isValid(state.selectedLanguageVersion)) return nothing();
        if (state.builderImageTag !== null && !isValid(state.builderImageTag)) return nothing();
        if (!isValid(state.runtimeImageTag)) return nothing();
        if (!isValid(state.selectedPort)) return nothing();

        return just({
            language: state.selectedLanguage.value.name,
            builderImageTag: state.builderImageTag !== null ? state.builderImageTag.value : null,
            runtimeImageTag: state.runtimeImageTag.value,
            port: state.selectedPort.value,
            location: state.location.value,
        });
    }

    function handleFormSubmit(e: FormEvent) {
        e.preventDefault();
        const createParams = validate();
        if (isNothing(createParams)) {
            return;
        }

        eventHandlers.onSetCreating();
        vscode.postCreateDockerfileRequest(createParams.value);
    }

    const selectedLanguage = state.selectedLanguage;
    const languageVersionLabel =
        (state.selectedLanguage.hasValue && state.selectedLanguage.value.versionDescription) || "Language version";
    return (
        <form className={styles.wrapper} onSubmit={handleFormSubmit}>
            <h2>Draft a Dockerfile</h2>
            <p>
                To automatically containerize the app, please define the application environment, the port to expose the
                app, and the directory of the app source code to build.
            </p>

            <fieldset className={styles.inputContainer} disabled={state.status !== "Editing"}>
                <label htmlFor="language-input" className={styles.label}>
                    Programming language *
                </label>
                <ResourceSelector<LanguageInfo>
                    id="language-input"
                    className={styles.control}
                    resources={supportedLanguages}
                    selectedItem={toNullable(selectedLanguage)}
                    valueGetter={(l) => l.name}
                    labelGetter={(l) => l.displayName}
                    onSelect={handleLanguageChange}
                />
                {hasMessage(selectedLanguage) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {selectedLanguage.message}
                    </span>
                )}

                {isValueSet(selectedLanguage) && (
                    <>
                        <label htmlFor="version-input" className={styles.label}>
                            {languageVersionLabel}
                        </label>
                        <TextWithDropdown
                            id="version-input"
                            className={styles.control}
                            getAddItemText={(text) => `Use "${text}"`}
                            items={selectedLanguage.value.exampleVersions}
                            selectedItem={toNullable(state.selectedLanguageVersion)}
                            onSelect={handleLanguageVersionChange}
                        />
                        {hasMessage(state.selectedLanguageVersion) && (
                            <span className={styles.validationMessage}>
                                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                {state.selectedLanguageVersion.message}
                            </span>
                        )}

                        {state.builderImageTag !== null && (
                            <>
                                <label htmlFor="builder-image-tag-input" className={styles.label}>
                                    Builder image tag *
                                </label>
                                <VSCodeTextField
                                    id="builder-image-tag-input"
                                    value={orDefault(state.builderImageTag, "")}
                                    className={styles.control}
                                    onBlur={handleBuilderImageTagChange}
                                    onInput={handleBuilderImageTagChange}
                                />
                                {hasMessage(state.builderImageTag) && (
                                    <span className={styles.validationMessage}>
                                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                        {state.builderImageTag.message}
                                    </span>
                                )}
                            </>
                        )}

                        <label htmlFor="runtime-image-tag-input" className={styles.label}>
                            Runtime image tag *
                        </label>
                        <VSCodeTextField
                            id="runtime-image-tag-input"
                            value={orDefault(state.runtimeImageTag, "")}
                            className={styles.control}
                            onBlur={handleRuntimeImageTagChange}
                            onInput={handleRuntimeImageTagChange}
                        />
                        {hasMessage(state.runtimeImageTag) && (
                            <span className={styles.validationMessage}>
                                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                {state.runtimeImageTag.message}
                            </span>
                        )}
                    </>
                )}

                <label htmlFor="port-input" className={styles.label}>
                    Application port *
                </label>
                <input
                    type="number"
                    id="port-input"
                    className={styles.control}
                    value={orDefault(state.selectedPort, "")}
                    onInput={handlePortChange}
                />
                {hasMessage(state.selectedPort) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {state.selectedPort.message}
                    </span>
                )}

                <label htmlFor="location-input" className={styles.label}>
                    Location
                </label>
                <VSCodeTextField
                    id="location-input"
                    readOnly
                    value={`.${state.workspaceConfig.pathSeparator}${state.location.value}`}
                    className={styles.control}
                />
                <div className={styles.controlSupplement}>
                    <VSCodeButton appearance="icon" onClick={handleChooseLocationClick}>
                        <span className={styles.iconButton}>
                            <FontAwesomeIcon icon={faFolder} />
                            &nbsp;Choose location
                        </span>
                    </VSCodeButton>
                </div>
                {hasMessage(state.location) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {state.location.message}
                    </span>
                )}
            </fieldset>

            <div className={styles.buttonContainer}>
                {state.status !== "Created" && (
                    <VSCodeButton type="submit" disabled={state.status !== "Editing" || isNothing(validate())}>
                        Create
                    </VSCodeButton>
                )}

                {state.existingFiles.map((path, i) => (
                    <VSCodeButton key={i} appearance="secondary" onClick={() => vscode.postOpenFileRequest(path)}>
                        Open {path}
                    </VSCodeButton>
                ))}
            </div>

            {state.status === "Created" && (
                <div className={styles.nextStepsContainer}>
                    <i className={`codicon codicon-sparkle ${styles.icon}`}></i>
                    <div className={styles.content}>
                        <h3>Next steps</h3>

                        <p>
                            If you still need to generate the appropriate deployment files, you can run{" "}
                            <VSCodeLink
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    vscode.postLaunchCommand(VsCodeCommand.DraftDeployment);
                                }}
                            >
                                Draft: Create a deployment
                            </VSCodeLink>{" "}
                            to easily create the appropriate files.
                        </p>

                        <p>
                            If you already have all the files you need to deploy and would like to generate a GitHub
                            Action, you can run{" "}
                            <VSCodeLink
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    vscode.postLaunchCommand(VsCodeCommand.DraftWorkflow);
                                }}
                            >
                                Draft: Create a GitHub workflow
                            </VSCodeLink>
                            .
                        </p>
                    </div>
                </div>
            )}
        </form>
    );
}
