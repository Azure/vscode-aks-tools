import { WebviewDefinition } from "../webviewTypes";

export interface KickstartSample {
    label: string;
    stack: string;
    description: string;
    repoUrl: string;
}

export type AppSourceKind = "repo" | "new" | "sample" | "workspace";

export type ProjectType = "frontend" | "backend" | "fullstack" | "agentic";

export interface AppSource {
    kind: AppSourceKind;
    repoUrl?: string;
    projectIdea?: string;
    projectType?: ProjectType;
    language?: string;
    sampleLabel?: string;
    sampleRepoUrl?: string;
}

export interface GuidedSetupSelections {
    appSource: AppSource;
}

export interface GitHubRepo {
    fullName: string;
    description: string | null;
    cloneUrl: string;
    private: boolean;
}

export interface InitialState {
    samples: KickstartSample[];
    workspaceIsEmpty: boolean;
}

export type ToVsCodeMsgDef = {
    finishRequest: GuidedSetupSelections;
    listGitHubReposRequest: void;
};

export type ToWebViewMsgDef = {
    errorNotification: { message: string };
    gitHubReposLoaded: { repos: GitHubRepo[]; signedInUser: string | null };
    gitHubReposError: { message: string; signedInUser: string | null };
};

export type KickstartGuidedSetupDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
