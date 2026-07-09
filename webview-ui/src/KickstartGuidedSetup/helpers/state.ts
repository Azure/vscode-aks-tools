import { GitHubRepo, InitialState } from "../../../../src/webview-contract/webviewDefinitions/kickstartGuidedSetup";
import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export enum Stage {
    CollectingInput,
    Finishing,
}

export type KickstartGuidedSetupState = InitialState & {
    stage: Stage;
    errorMessage: string | null;
    githubRepos: GitHubRepo[] | null;
    githubReposLoading: boolean;
    githubReposError: string | null;
    githubSignedInUser: string | null;
};

export type EventDef = {
    setFinishing: void;
    setGitHubReposLoading: void;
};

export const stateUpdater: WebviewStateUpdater<"kickstartGuidedSetup", EventDef, KickstartGuidedSetupState> = {
    createState: (initialState) => ({
        ...initialState,
        stage: Stage.CollectingInput,
        errorMessage: null,
        githubRepos: null,
        githubReposLoading: false,
        githubReposError: null,
        githubSignedInUser: null,
    }),
    vscodeMessageHandler: {
        errorNotification: (state, args) => ({ ...state, errorMessage: args.message }),
        gitHubReposLoaded: (state, args) => ({
            ...state,
            githubRepos: args.repos,
            githubReposLoading: false,
            githubReposError: null,
            githubSignedInUser: args.signedInUser,
        }),
        gitHubReposError: (state, args) => ({
            ...state,
            githubReposLoading: false,
            githubReposError: args.message,
            githubSignedInUser: args.signedInUser ?? state.githubSignedInUser,
        }),
    },
    eventHandler: {
        setFinishing: (state) => ({ ...state, stage: Stage.Finishing }),
        setGitHubReposLoading: (state) => ({
            ...state,
            githubReposLoading: true,
            githubReposError: null,
        }),
    },
};

export const vscode = getWebviewMessageContext<"kickstartGuidedSetup">({
    finishRequest: null,
    listGitHubReposRequest: null,
});
