import {
    faBuilding,
    faCheckToSlot,
    faCircle,
    faCode,
    faCodeBranch,
    faCubes,
    faFolderOpen,
    faLayerGroup,
    faRobot,
    faServer,
    faSpinner,
    faStore,
    faTimesCircle,
    faUser,
    faWandMagicSparkles,
    faWindowMaximize,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { FormEvent, useEffect, useState } from "react";
import * as l10n from "@vscode/l10n";
import { MessageSink } from "../../../src/webview-contract/messaging";
import {
    AppSource,
    AppSourceKind,
    GitHubRepo,
    GuidedSetupSelections,
    KickstartSample,
    ProjectType,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/kickstartGuidedSetup";
import { SearchableDropdown } from "../components/SearchableDropdown";
import { Maybe, isNothing, just, nothing } from "../utilities/maybe";
import { EventHandlers } from "../utilities/state";
import { Validatable, hasMessage, isValid, isValueSet, missing, unset, valid } from "../utilities/validation";
import styles from "./KickstartGuidedSetup.module.css";
import { EventDef } from "./helpers/state";

interface GuidedSetupInputProps {
    samples: KickstartSample[];
    workspaceIsEmpty: boolean;
    errorMessage: string | null;
    githubRepos: GitHubRepo[] | null;
    githubReposLoading: boolean;
    githubReposError: string | null;
    githubSignedInUser: string | null;
    eventHandlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
}

const APP_SOURCE_LABELS: Record<AppSourceKind, string> = {
    repo: "Start from a GitHub repo",
    new: "Make something new",
    sample: "Start from an example",
    workspace: "Use my current workspace",
};

const APP_SOURCE_ICONS: Record<AppSourceKind, typeof faCircle> = {
    repo: faCodeBranch,
    new: faWandMagicSparkles,
    sample: faLayerGroup,
    workspace: faFolderOpen,
};

const APP_SOURCE_ORDER: AppSourceKind[] = ["repo", "new", "sample", "workspace"];

const PROJECT_TYPE_ORDER: ProjectType[] = ["frontend", "backend", "fullstack", "agentic"];

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
    frontend: "Frontend",
    backend: "Backend",
    fullstack: "Full stack",
    agentic: "Agentic",
};

const PROJECT_TYPE_ICONS: Record<ProjectType, typeof faCircle> = {
    frontend: faWindowMaximize,
    backend: faServer,
    fullstack: faCubes,
    agentic: faRobot,
};

const SAMPLE_ICONS: Record<string, typeof faCircle> = {
    "AKS Store Demo": faStore,
    "Azure Voting App": faCheckToSlot,
    "Contoso Real Estate": faBuilding,
};

const LANGUAGE_OPTIONS: string[] = ["React", "Node.js", "Python", "Go", "Java", ".NET", "Rust"];

export function GuidedSetupInput(props: GuidedSetupInputProps) {
    const availableAppSources = APP_SOURCE_ORDER.filter((kind) => kind !== "workspace" || !props.workspaceIsEmpty);
    const [appSourceKind, setAppSourceKind] = useState<AppSourceKind>(availableAppSources[0]);
    const [repoUrl, setRepoUrl] = useState<Validatable<string>>(unset());
    const [projectType, setProjectType] = useState<ProjectType | null>(null);
    const [language, setLanguage] = useState<string | null>(null);
    const [projectIdea, setProjectIdea] = useState<string>("");
    const [sampleLabel, setSampleLabel] = useState<string>(props.samples[0]?.label ?? "");
    const [submitAttempted, setSubmitAttempted] = useState(false);

    // Auto-load the user's GitHub repositories the first time they open the
    // "Start from a GitHub repo" section. Uses whichever GitHub account is
    // currently signed in to VS Code (no prompt, no account picker).
    useEffect(() => {
        if (
            appSourceKind === "repo" &&
            props.githubRepos === null &&
            !props.githubReposLoading &&
            props.githubReposError === null
        ) {
            props.eventHandlers.onSetGitHubReposLoading();
            props.vscode.postListGitHubReposRequest();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appSourceKind]);

    function buildAppSource(): AppSource | null {
        switch (appSourceKind) {
            case "repo":
                return isValid(repoUrl) ? { kind: "repo", repoUrl: repoUrl.value } : null;
            case "new":
                if (projectType === null || language === null) return null;
                return { kind: "new", projectType, language, projectIdea: projectIdea.trim() || undefined };
            case "sample": {
                const sample = props.samples.find((s) => s.label === sampleLabel);
                return sample ? { kind: "sample", sampleLabel: sample.label, sampleRepoUrl: sample.repoUrl } : null;
            }
            case "workspace":
                return { kind: "workspace" };
        }
    }

    function validate(): Maybe<GuidedSetupSelections> {
        const appSource = buildAppSource();
        if (!appSource) return nothing();
        return just({ appSource });
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setSubmitAttempted(true);
        const parameters = validate();
        if (isNothing(parameters)) return;
        props.vscode.postFinishRequest(parameters.value);
        props.eventHandlers.onSetFinishing();
    }

    function renderValidationMessage(field: Validatable<unknown>) {
        if (!hasMessage(field)) return null;
        return (
            <span className={styles.validationMessage}>
                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                {field.message}
            </span>
        );
    }

    return (
        <form className={styles.inputContainer} onSubmit={handleSubmit}>
            <label className={styles.choiceLabel}>{l10n.t("App source*")}</label>
            <div className={styles.choiceGroup}>
                {availableAppSources.map((kind) => (
                    <button
                        type="button"
                        key={kind}
                        className={`${styles.choiceCard} ${appSourceKind === kind ? styles.choiceSelected : ""}`}
                        aria-pressed={appSourceKind === kind}
                        onClick={() => setAppSourceKind(kind)}
                    >
                        <FontAwesomeIcon className={styles.choiceCardIcon} icon={APP_SOURCE_ICONS[kind]} />
                        <span>{l10n.t(APP_SOURCE_LABELS[kind])}</span>
                    </button>
                ))}
            </div>

            {appSourceKind === "repo" && (
                <div className={styles.ghSection}>
                    <div className={styles.ghHeader}>
                        <span className={styles.ghHeaderTitle}>
                            <FontAwesomeIcon icon={faCodeBranch} />
                            {l10n.t("Your GitHub repositories")}
                        </span>
                        <div className={styles.ghHeaderActions}>
                            {props.githubReposLoading && (
                                <span className={styles.ghLoading}>
                                    <FontAwesomeIcon icon={faSpinner} spin />
                                    {l10n.t("Loading…")}
                                </span>
                            )}
                            {props.githubSignedInUser && (
                                <>
                                    <span className={styles.ghEmptyHint}>{l10n.t("Signed in as")}</span>
                                    <span className={styles.ghAccountPill}>
                                        <FontAwesomeIcon icon={faUser} />
                                        {props.githubSignedInUser}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    {props.githubReposError && (
                        <span className={styles.ghErrorRow}>
                            <FontAwesomeIcon icon={faTimesCircle} />
                            {props.githubReposError}
                        </span>
                    )}

                    {props.githubRepos && props.githubRepos.length === 0 && (
                        <span className={styles.ghEmptyHint}>
                            {l10n.t("No repositories were found for this GitHub account.")}
                        </span>
                    )}

                    {props.githubRepos && props.githubRepos.length > 0 && (
                        <SearchableDropdown
                            id="github-repo-dropdown"
                            className={styles.ghDropdown}
                            items={props.githubRepos}
                            selectedValue={
                                isValueSet(repoUrl) && props.githubRepos.some((r) => r.cloneUrl === repoUrl.value)
                                    ? repoUrl.value
                                    : null
                            }
                            getValue={(repo) => repo.cloneUrl}
                            toLabel={(repo) => {
                                const name = repo.fullName.split("/").slice(1).join("/") || repo.fullName;
                                return `${name}${repo.private ? "  •  private" : ""}${
                                    repo.description ? `  —  ${repo.description}` : ""
                                }`;
                            }}
                            onSelect={(value) => {
                                if (value) setRepoUrl(valid(value));
                            }}
                        />
                    )}

                    <div className={styles.ghDivider}>{l10n.t("or")}</div>

                    <div className={styles.ghManualField}>
                        <label htmlFor="repo-url-input">{l10n.t("Paste a repository URL*")}</label>
                        <input
                            type="text"
                            id="repo-url-input"
                            className={styles.ghManualInput}
                            value={isValueSet(repoUrl) ? repoUrl.value : ""}
                            placeholder="https://github.com/owner/repo"
                            onInput={(e) => {
                                const v = e.currentTarget.value;
                                setRepoUrl(v ? valid(v) : missing<string>(l10n.t("A repository URL is required.")));
                            }}
                        />
                        {renderValidationMessage(repoUrl)}
                    </div>
                </div>
            )}

            {appSourceKind === "new" && (
                <>
                    <label className={styles.choiceLabel}>{l10n.t("Project type*")}</label>
                    <div className={styles.choiceGroup}>
                        {PROJECT_TYPE_ORDER.map((type) => (
                            <button
                                type="button"
                                key={type}
                                className={`${styles.choiceCard} ${projectType === type ? styles.choiceSelected : ""}`}
                                aria-pressed={projectType === type}
                                onClick={() => setProjectType(type)}
                            >
                                <FontAwesomeIcon className={styles.choiceCardIcon} icon={PROJECT_TYPE_ICONS[type]} />
                                <span>{l10n.t(PROJECT_TYPE_LABELS[type])}</span>
                            </button>
                        ))}
                    </div>

                    {projectType !== null && (
                        <>
                            <label className={styles.choiceLabel}>{l10n.t("Language / framework*")}</label>
                            <div className={styles.choiceGroup}>
                                {LANGUAGE_OPTIONS.map((option) => (
                                    <button
                                        type="button"
                                        key={option}
                                        className={`${styles.choiceCard} ${language === option ? styles.choiceSelected : ""}`}
                                        aria-pressed={language === option}
                                        onClick={() => setLanguage(option)}
                                    >
                                        <FontAwesomeIcon className={styles.choiceCardIcon} icon={faCode} />
                                        <span>{option}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    <label htmlFor="project-idea-input" className={styles.choiceLabel}>
                        {l10n.t("Anything specific in mind? (optional)")}
                    </label>
                    <input
                        type="text"
                        id="project-idea-input"
                        className={styles.fullWidthControl}
                        value={projectIdea}
                        placeholder={l10n.t("e.g. a REST API for tracking inventory backed by PostgreSQL")}
                        onInput={(e) => setProjectIdea(e.currentTarget.value)}
                    />
                </>
            )}

            {appSourceKind === "sample" && (
                <>
                    <label className={styles.choiceLabel}>{l10n.t("Sample*")}</label>
                    <div className={styles.choiceGroup}>
                        {props.samples.map((sample) => (
                            <button
                                type="button"
                                key={sample.label}
                                className={`${styles.choiceCard} ${sampleLabel === sample.label ? styles.choiceSelected : ""}`}
                                aria-pressed={sampleLabel === sample.label}
                                title={sample.description}
                                onClick={() => setSampleLabel(sample.label)}
                            >
                                <FontAwesomeIcon
                                    className={styles.choiceCardIcon}
                                    icon={SAMPLE_ICONS[sample.label] ?? faCubes}
                                />
                                <span className={styles.choiceCardText}>
                                    <span>{sample.label}</span>
                                    <span className={styles.choiceCardSub}>{sample.stack}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}

            {props.errorMessage && (
                <span className={`${styles.validationMessage} ${styles.fullWidth}`}>
                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                    {props.errorMessage}
                </span>
            )}
            {submitAttempted && isNothing(validate()) && (
                <span className={`${styles.validationMessage} ${styles.fullWidth}`}>
                    {l10n.t("Please complete all required fields before continuing.")}
                </span>
            )}

            <div className={`${styles.buttonContainer} ${styles.fullWidth}`}>
                <button type="submit">{l10n.t("Continue")}</button>
            </div>
        </form>
    );
}
