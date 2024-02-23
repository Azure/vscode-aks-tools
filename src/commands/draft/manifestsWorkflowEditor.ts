import { DocumentSymbol, Uri } from "vscode";
import { BaseWorkflowEditor } from "./baseWorkflowEditor";
import { ManifestsDeploymentParams } from "../../webview-contract/webviewDefinitions/draft/types";
import { Errorable, failed } from "../utils/errorable";
import { CreateParams } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import { asPosixRelativePath } from "./workflowUtils";

export class ManifestsWorkflowEditor extends BaseWorkflowEditor<"manifests"> {
    private deploymentParams: ManifestsDeploymentParams;

    constructor(symbols: DocumentSymbol[], fileUri: Uri, createParams: CreateParams) {
        super("manifests", fileUri, symbols, createParams);
        this.deploymentParams = createParams.deploymentParams as ManifestsDeploymentParams;
    }

    protected makeDeploymentSpecificUpdates(): Errorable<void> {
        const envSymbol = this.getSymbolFromProperties(this.symbols, "env");
        if (failed(envSymbol)) {
            return envSymbol;
        }
        const manifestPaths = this.deploymentParams.manifestPaths.map((p) => asPosixRelativePath(p));
        this.updateEnvVar(envSymbol.result, "DEPLOYMENT_MANIFEST_PATH", ...manifestPaths);

        const deployStepsSymbol = this.getSymbolFromProperties(this.symbols, "jobs", "deploy", "steps");
        if (failed(deployStepsSymbol)) {
            return deployStepsSymbol;
        }

        const stepSymbols = deployStepsSymbol.result.children;
        const lastStepSymbol = stepSymbols[stepSymbols.length - 1];
        const withSymbol = this.getSymbolFromProperties(lastStepSymbol.children, "with");
        if (failed(withSymbol)) {
            return withSymbol;
        }

        const namespaceSymbol = this.getSymbolFromProperties(withSymbol.result.children, "namespace");
        if (failed(namespaceSymbol)) {
            const indentation = " ".repeat(this.getIndentationDepth() + lastStepSymbol.range.start.character);
            this.workspaceEdit.insert(
                this.fileUri,
                withSymbol.result.range.end,
                `\n${indentation}namespace: ${this.createParams.namespace}`,
            );
        } else {
            this.workspaceEdit.replace(
                this.fileUri,
                namespaceSymbol.result.range,
                `namespace: ${this.createParams.namespace}`,
            );
        }

        return { succeeded: true, result: undefined };
    }
}
