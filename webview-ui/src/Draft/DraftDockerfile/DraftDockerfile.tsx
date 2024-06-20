import { FormEvent, MouseEvent } from "react";
import { CreateParams, InitialState } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDockerfile";
import { ResourceSelector } from "../../components/ResourceSelector";
import { useStateManagement } from "../../utilities/state";
import styles from "../Draft.module.css";
import { stateUpdater, vscode } from "./state";
import { VSCodeButton, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFolder } from "@fortawesome/free-regular-svg-icons";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { Maybe, isNothing, just, nothing } from "../../utilities/maybe";
import { LanguageInfo } from "../../../../src/webview-contract/webviewDefinitions/draft/types";
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

export function DraftDockerfile(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    function handleChooseLocationClick() {
        vscode.postPickLocationRequest({
            defaultPath: state.workspaceConfig.fullPath,
            type: "directory",
            title: "Location to save Dockerfile",
            buttonLabel: "Select",
        });
    }

    function handleLanguageChange(language: LanguageInfo | null) {
        const validated = language === null ? missing<LanguageInfo>("Language is required.") : valid(language);
        eventHandlers.onSetSelectedLanguage(validated);
    }

    function handleLanguageVersionChange(version: string | null) {
        const validated = getValidatedLanguageVersion();
        eventHandlers.onSetSelectedLanguageVersion(validated);
        if (isValid(state.selectedLanguage) && isValid(validated)) {
            vscode.postGetLanguageVersionInfoRequest({
                language: state.selectedLanguage.value.name,
                version: validated.value,
            });
        }

        function getValidatedLanguageVersion(): Validatable<string> {
            if (version === null || version.length === 0) {
                return missing("Language version is required.");
            }

            return valid(version);
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

    function validate(): Maybe<CreateParams> {
        if (!isValid(state.selectedLocation)) return nothing();
        if (!isValid(state.selectedLanguage)) return nothing();
        if (!isValid(state.selectedLanguageVersion)) return nothing();
        if (state.isBuilderImageRequired && !isValid(state.builderImageTag)) return nothing();
        if (!isValid(state.runtimeImageTag)) return nothing();
        if (!isValid(state.selectedPort)) return nothing();

        return just({
            language: state.selectedLanguage.value.name,
            builderImageTag: orDefault(state.builderImageTag, null),
            runtimeImageTag: state.runtimeImageTag.value,
            port: state.selectedPort.value,
            location: state.selectedLocation.value,
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

    function handleDraftDeploymentClick(e: MouseEvent) {
        e.preventDefault();
        vscode.postLaunchDraftDeployment({
            initialTargetPort: orDefault(state.selectedPort, null),
            initialLocation: state.selectedLocation.value,
        });
    }

    function handleDraftWorkflowClick(e: MouseEvent) {
        e.preventDefault();
        vscode.postLaunchDraftWorkflow({
            initialDockerfileLocation: state.selectedLocation.value,
        });
    }

    const locationTooltipMessage = "The folder where the Dockerfile will be saved.";

    const selectedLanguage = state.selectedLanguage;
    const languageVersionLabel =
        (state.selectedLanguage.hasValue && state.selectedLanguage.value.versionDescription) || "Language version";

    const languageVersionTooltipMessage =
        "The language version will be used to determine the builder and runtime image tags in the Dockerfile.";

    return (
        <form className={styles.wrapper} onSubmit={handleFormSubmit}>
            <h2>Automated Deployments: Draft a Dockerfile</h2>
            <p>
                To automatically containerize the app, please define the application environment, the port to expose the
                app, and the directory of the app source code to build.
            </p>

            <fieldset className={styles.inputContainer} disabled={state.status !== "Editing"}>
                <label htmlFor="location-input" className={styles.label}>
                    Location
                    <span className={"tooltip-holder"} data-tooltip-text={locationTooltipMessage}>
                        <i className={`${styles.inlineIcon} codicon codicon-info`} />
                    </span>
                </label>
                <VSCodeTextField
                    id="location-input"
                    readOnly
                    value={`.${state.workspaceConfig.pathSeparator}${state.selectedLocation.value}`}
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
                {hasMessage(state.selectedLocation) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {state.selectedLocation.message}
                    </span>
                )}

                <label htmlFor="language-input" className={styles.label}>
                    Programming language *
                </label>
                <ResourceSelector<LanguageInfo>
                    id="language-input"
                    className={styles.control}
                    resources={state.supportedLanguages}
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
                            {languageVersionLabel} *
                            <span className={"tooltip-holder"} data-tooltip-text={languageVersionTooltipMessage}>
                                <i className={`${styles.inlineIcon} codicon codicon-info`} />
                            </span>
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
                        {state.isBuilderImageRequired && hasMessage(state.builderImageTag) && (
                            <span className={styles.validationMessage}>
                                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                {state.builderImageTag.message}
                            </span>
                        )}
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
                            <VSCodeLink href="#" onClick={handleDraftDeploymentClick}>
                                Automated Deployments: Create a deployment
                            </VSCodeLink>{" "}
                            to easily create the appropriate files.
                        </p>

                        <p>
                            If you already have all the files you need to deploy and would like to generate a GitHub
                            Action, you can run{" "}
                            <VSCodeLink href="#" onClick={handleDraftWorkflowClick}>
                                Automated Deployments: Create a GitHub workflow
                            </VSCodeLink>
                            .
                        </p>
                    </div>
                </div>
            )}
        </form>
    );
}
