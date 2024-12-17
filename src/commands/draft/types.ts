import { WorkspaceFolder } from "vscode";
import { InitialSelection as DeploymentInitialSelection } from "../../webview-contract/webviewDefinitions/draft/draftDeployment";
import { InitialSelection as WorkflowInitialSelection } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";

export type DraftCommandParamsTypes = {
    "aks.draftDockerfile": {
        workspaceFolder?: WorkspaceFolder;
        initialLocation?: string;
    };
    "aks.draftDeployment": {
        workspaceFolder?: WorkspaceFolder;
        initialLocation?: string;
        initialSelection?: DeploymentInitialSelection;
    };
    "aks.draftWorkflow": {
        workspaceFolder?: WorkspaceFolder;
        initialSelection?: WorkflowInitialSelection;
    };
    "aks.draftValidate": {
        workspaceFolder?: WorkspaceFolder;
        initialLocation?: string;
    };
};

export type DraftCommandName = keyof DraftCommandParamsTypes;

export type DraftCommandParamsType<T extends DraftCommandName> = DraftCommandParamsTypes[T];
