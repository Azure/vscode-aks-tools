import { WebviewDefinition } from "../webviewTypes";

export interface KickstartSample {
    label: string;
    stack: string;
    description: string;
    repoUrl: string;
}

export type AppSourceKind = "repo" | "new" | "sample" | "workspace";

export type ProjectType = "frontend" | "backend" | "fullstack" | "agentic";

export type AppSource =
    | { kind: "repo"; repoUrl: string }
    | { kind: "new"; projectType: ProjectType; language: string; projectIdea?: string }
    | { kind: "sample"; sampleLabel: string; sampleRepoUrl: string }
    | { kind: "workspace" };

export interface GuidedSetupSelections {
    appSource: AppSource;
}

export interface GitHubRepo {
    fullName: string;
    description: string | null;
    cloneUrl: string;
    private: boolean;
    /** ISO timestamp of the last push, or null if GitHub didn't report one. */
    pushedAt: string | null;
}

export interface InitialState {
    samples: KickstartSample[];
    workspaceIsEmpty: boolean;
}

export type ToVsCodeMsgDef = {
    finishRequest: GuidedSetupSelections;
    /** `prompt` gates the interactive sign-in/consent dialog; background loads pass false. */
    listGitHubReposRequest: { prompt: boolean };
};

export type ToWebViewMsgDef = {
    errorNotification: { message: string };
    gitHubReposLoaded: { repos: GitHubRepo[]; signedInUser: string | null; hasMore: boolean };
    gitHubReposError: { message: string; signedInUser: string | null; needsSignIn: boolean };
};

export type KickstartGuidedSetupDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
