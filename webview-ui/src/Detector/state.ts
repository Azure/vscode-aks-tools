import { InitialState } from "../../../src/webview-contract/webviewDefinitions/detector";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type DetectorState = InitialState & {
    portalUrl: string;
};

export const stateUpdater: WebviewStateUpdater<"detector", EventDef, DetectorState> = {
    createState: (initialState) => ({
        ...initialState,
        portalUrl: `https://portal.azure.com/#resource${initialState.clusterArmId}aksDiagnostics?referrer_source=vscode&referrer_context=${initialState.portalReferrerContext}`,
    }),
    vscodeMessageHandler: {},
    eventHandler: {},
};

export const vscode = getWebviewMessageContext<"detector">({});
