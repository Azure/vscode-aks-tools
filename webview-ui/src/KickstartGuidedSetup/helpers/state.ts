import { InitialState } from "../../../../src/webview-contract/webviewDefinitions/kickstartGuidedSetup";
import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export enum Stage {
    CollectingInput,
    Finishing,
}

export type KickstartGuidedSetupState = InitialState & {
    stage: Stage;
    errorMessage: string | null;
};

export type EventDef = {
    setFinishing: void;
};

export const stateUpdater: WebviewStateUpdater<"kickstartGuidedSetup", EventDef, KickstartGuidedSetupState> = {
    createState: (initialState) => ({
        ...initialState,
        stage: Stage.CollectingInput,
        errorMessage: null,
    }),
    vscodeMessageHandler: {
        errorNotification: (state, args) => ({ ...state, errorMessage: args.message }),
    },
    eventHandler: {
        setFinishing: (state) => ({ ...state, stage: Stage.Finishing }),
    },
};

export const vscode = getWebviewMessageContext<"kickstartGuidedSetup">({
    finishRequest: null,
});
