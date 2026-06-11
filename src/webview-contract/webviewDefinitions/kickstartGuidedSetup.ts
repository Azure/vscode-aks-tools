import { WebviewDefinition } from "../webviewTypes";

export interface KickstartSample {
    label: string;
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

export interface InitialState {
    samples: KickstartSample[];
    workspaceIsEmpty: boolean;
}

export type ToVsCodeMsgDef = {
    finishRequest: GuidedSetupSelections;
};

export type ToWebViewMsgDef = {
    errorNotification: { message: string };
};

export type KickstartGuidedSetupDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
