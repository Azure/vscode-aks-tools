import { InitialState, ModelDetails, ProgressEventType } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type KaitoState = InitialState & {
    operationDescription: string;
    kaitoInstallStatus: ProgressEventType;
    errors: string | undefined;
    models: ModelDetails[];
};

export type DeploymentState = {
    clusterName: string;
    modelName: string;
    workspaceExists: boolean;
    resourceReady: boolean | null;
    inferenceReady: boolean | null;
    workspaceReady: boolean | null;
    age: number;
};

export const stateUpdater: WebviewStateUpdater<"kaito", EventDef, KaitoState> = {
    createState: (initialState) => ({
        ...initialState,
        operationDescription: "",
        kaitoInstallStatus: ProgressEventType.NotStarted,
        errors: undefined,
        models: [],
    }),
    vscodeMessageHandler: {
        kaitoInstallProgressUpdate: (state, args) => ({
            ...state,
            operationDescription: args.operationDescription,
            kaitoInstallStatus: args.event,
            errors: args.errorMessage,
            models: args.models,
        }),
        getLLMModelsResponse: (state, args) => ({
            ...state,
            models: args.models,
        }),
        getWorkspaceResponse: (state, args) => ({
            ...state,
            workspace: args.workspace,
        }),
    },
    eventHandler: {},
};

export const vscode = getWebviewMessageContext<"kaito">({
    installKaitoRequest: null,
    getLLMModelsRequest: null,
    generateWorkspaceRequest: null,
    deployWorkspace: null,
});

export const vscode2 = getWebviewMessageContext<"kaitoModels">({
    generateCRDRequest: null,
    deployKaitoRequest: null,
    workspaceExistsRequest: null,
    updateStateRequest: null,
    resetStateRequest: null,
    cancelRequest: null,
});

export const stateUpdater2: WebviewStateUpdater<"kaitoModels", EventDef, DeploymentState> = {
    createState: (initialState) => ({
        ...initialState,
        modelName: "",
        workspaceExists: false,
        resourceReady: false,
        inferenceReady: false,
        workspaceReady: false,
        age: 0,
    }),
    vscodeMessageHandler: {
        deploymentProgressUpdate: (state, args) => ({
            ...state,
            modelName: args.modelName,
            workspaceExists: args.workspaceExists,
            resourceReady: args.resourceReady,
            inferenceReady: args.inferenceReady,
            workspaceReady: args.workspaceReady,
            age: args.age,
        }),
    },
    eventHandler: {},
};
