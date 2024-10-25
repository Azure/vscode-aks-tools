import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type DeploymentState = {
    clusterName: string;
    modelName: string;
    workspaceExists: boolean;
    resourceReady: boolean | null;
    inferenceReady: boolean | null;
    workspaceReady: boolean | null;
    age: number;
};

export const vscode = getWebviewMessageContext<"kaitoModels">({
    generateCRDRequest: null,
    deployKaitoRequest: null,
    workspaceExistsRequest: null,
    updateStateRequest: null,
    resetStateRequest: null,
    cancelRequest: null,
});

export const stateUpdater: WebviewStateUpdater<"kaitoModels", EventDef, DeploymentState> = {
    createState: (initialState) => ({
        ...initialState,
        modelName: "",
        workspaceExists: false,
        resourceReady: null,
        inferenceReady: null,
        workspaceReady: null,
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
