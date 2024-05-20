import { DocumentSymbol, Uri } from "vscode";
import { BaseWorkflowEditor } from "./baseWorkflowEditor";
import { HelmDeploymentParams, HelmOverride } from "../../webview-contract/webviewDefinitions/draft/types";
import { Errorable, failed } from "../utils/errorable";
import { CreateParams } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import { asPosixRelativePath } from "./workflowUtils";

export class HelmWorkflowEditor extends BaseWorkflowEditor<"helm"> {
    private deploymentParams: HelmDeploymentParams;

    constructor(symbols: DocumentSymbol[], fileUri: Uri, createParams: CreateParams) {
        super("helm", fileUri, symbols, createParams);
        this.deploymentParams = createParams.deploymentParams as HelmDeploymentParams;
    }

    protected makeDeploymentSpecificUpdates(): Errorable<void> {
        const envSymbol = this.getSymbolFromProperties(this.symbols, "env");
        if (failed(envSymbol)) {
            return envSymbol;
        }

        const formattedOverrides = this.getFormattedOverrides();
        this.updateEnvVar(envSymbol.result, "CHART_OVERRIDES", formattedOverrides);
        this.updateEnvVar(envSymbol.result, "CHART_PATH", asPosixRelativePath(this.deploymentParams.chartPath));
        this.updateEnvVar(
            envSymbol.result,
            "CHART_OVERRIDE_PATH",
            asPosixRelativePath(this.deploymentParams.valuesYamlPath),
        );

        const deployStepsSymbol = this.getSymbolFromProperties(this.symbols, "jobs", "deploy", "steps");
        if (failed(deployStepsSymbol)) {
            return deployStepsSymbol;
        }

        const stepSymbols = deployStepsSymbol.result.children;
        const lastStepSymbol = stepSymbols[stepSymbols.length - 1];
        const runSymbol = this.getSymbolFromProperties(lastStepSymbol.children, "run");
        if (failed(runSymbol)) {
            return runSymbol;
        }

        const helmCommand = this.getHelmCommand();
        this.workspaceEdit.replace(this.fileUri, runSymbol.result.range, `run: ${helmCommand}`);

        return { succeeded: true, result: undefined };
    }

    private getFormattedOverrides(): string {
        const imageName = `${this.createParams.acrName}.azurecr.io/${this.createParams.repositoryName}`;
        const overrides: HelmOverride[] = [
            { key: "image.repository", value: imageName },
            { key: "image.tag", value: "${{ github.sha }}" },
            ...this.deploymentParams.overrides,
        ];

        // Return formatted overrides as a comma-separated string for use in the `--set` argument in `helm upgrade`.
        return overrides.map((o) => `${o.key}=${o.value}`).join(",");
    }

    private getHelmCommand(): string {
        // TODO: Get from app name?
        const helmChartName = "automated-deployment";
        return `helm upgrade --wait -i -f \${{ env.CHART_OVERRIDE_PATH }} --set \${{ env.CHART_OVERRIDES }} ${helmChartName} \${{ env.CHART_PATH }}`;
    }
}
