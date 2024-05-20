import { DocumentSymbol, Uri, WorkspaceEdit, workspace } from "vscode";
import { Errorable, failed } from "../utils/errorable";
import { CreateParams } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import { asPosixRelativePath, getMultilineStringValue } from "./workflowUtils";

export type WorkflowDeploymentType = "manifests" | "helm";

/**
 * Interface representing a type that can perform updates to a local GitHub workflow file.
 */
export interface WorkflowEditor {
    /**
     * Applies updates to the workflow file.
     */
    update(): Promise<Errorable<void>>;
}

/**
 * Base class for editing a GitHub workflow file generated using the Draft tool.
 */
export abstract class BaseWorkflowEditor<TDeploymentType extends WorkflowDeploymentType> {
    readonly workspaceEdit: WorkspaceEdit = new WorkspaceEdit();
    protected constructor(
        readonly deploymentType: TDeploymentType,
        readonly fileUri: Uri,
        readonly symbols: DocumentSymbol[],
        readonly createParams: CreateParams,
    ) {}

    /**
     * Performs all updates applicable to all types of deployments. Any deployment-specific updates are
     * delegated to derived classes.
     */
    public async update(): Promise<Errorable<void>> {
        this.setName();

        const setBranchResult = this.setBranch();
        if (failed(setBranchResult)) {
            return setBranchResult;
        }

        const envSymbol = this.getSymbolFromProperties(this.symbols, "env");
        if (failed(envSymbol)) {
            return envSymbol;
        }

        this.updateCommonEnvVars(envSymbol.result);
        this.setBuildImageRunCommand();

        const deploymentUpdatesResult = this.makeDeploymentSpecificUpdates();
        if (failed(deploymentUpdatesResult)) {
            return deploymentUpdatesResult;
        }

        await workspace.applyEdit(this.workspaceEdit);
        return { succeeded: true, result: undefined };
    }

    private setName(): Errorable<void> {
        const result = this.symbols.find((s) => s.name === "name");
        if (!result) {
            return { succeeded: false, error: "Failed to find name symbol in workflow" };
        }

        this.workspaceEdit.replace(this.fileUri, result.range, `name: ${this.createParams.workflowName}`);
        return { succeeded: true, result: undefined };
    }

    /**
     * Gets the indentation depth for the YAML content of this file.
     * @returns The indentation depth of the first symbol that has children. If no such symbol is found, returns 2.
     */
    protected getIndentationDepth(): number {
        const symbolWithChildren = this.symbols.find((s) => s.children.length > 0);
        if (!symbolWithChildren) {
            return 2;
        }

        return symbolWithChildren.children[0].range.start.character;
    }

    private setBranch(): Errorable<void> {
        const branchesSymbol = this.getSymbolFromProperties(this.symbols, "on", "push", "branches");
        if (failed(branchesSymbol)) {
            return { succeeded: false, error: "Failed to find branches symbol in workflow" };
        }

        const branchName = this.createParams.branchName;
        this.workspaceEdit.replace(this.fileUri, branchesSymbol.result.range, `branches: [${branchName}]`);
        return { succeeded: true, result: undefined };
    }

    private updateCommonEnvVars(envSymbol: DocumentSymbol): void {
        this.updateEnvVar(envSymbol, "CONTAINER_NAME", this.createParams.repositoryName);
        this.updateEnvVar(envSymbol, "CLUSTER_NAME", this.createParams.clusterName);
        this.updateEnvVar(envSymbol, "AZURE_CONTAINER_REGISTRY", this.createParams.acrName);
        this.updateEnvVar(envSymbol, "CLUSTER_RESOURCE_GROUP", this.createParams.clusterResourceGroup);
        this.updateEnvVar(envSymbol, "ACR_RESOURCE_GROUP", this.createParams.acrResourceGroup);
    }

    /**
     * Performs updates specific to the deployment type of the workflow.
     */
    protected abstract makeDeploymentSpecificUpdates(): Errorable<void>;

    /**
     * Adds or updates an environment variable in the workflow file. The value of this variable can
     * be either a string or an array. Array values will use YAML's block scalar syntax.
     */
    protected updateEnvVar(envSymbol: DocumentSymbol, name: string, ...values: string[]): void {
        const symbol = envSymbol.children.find((s) => s.name === name);
        const indentationDepth = this.getIndentationDepth();
        if (symbol === undefined) {
            const singleSpace = " ";
            const indentation = singleSpace.repeat(indentationDepth);
            this.workspaceEdit.insert(
                this.fileUri,
                envSymbol.range.end,
                `\n${indentation}${name}: ${getValueString()}`,
            );
        } else {
            this.workspaceEdit.replace(this.fileUri, symbol.range, `${name}: ${getValueString()}`);
        }

        function getValueString() {
            if (values.length === 0) {
                return "";
            } else if (values.length === 1) {
                return values[0];
            } else {
                return getMultilineStringValue(indentationDepth * 2, values);
            }
        }
    }

    private setBuildImageRunCommand(): Errorable<void> {
        const buildImageStepsSymbol = this.getSymbolFromProperties(this.symbols, "jobs", "buildImage", "steps");
        if (failed(buildImageStepsSymbol)) {
            return buildImageStepsSymbol;
        }
        const stepSymbols = buildImageStepsSymbol.result.children;
        const lastStepSymbol = stepSymbols[stepSymbols.length - 1];
        const runSymbol = this.getSymbolFromProperties(lastStepSymbol.children, "run");
        if (failed(runSymbol)) {
            return runSymbol;
        }

        const dockerfilePath = asPosixRelativePath(this.createParams.dockerfilePath);
        const buildContext = asPosixRelativePath(this.createParams.buildContextPath);
        const runCommand = `az acr build --image \${{ env.CONTAINER_NAME }}:\${{ github.sha }} --registry \${{ env.AZURE_CONTAINER_REGISTRY }} -g \${{ env.ACR_RESOURCE_GROUP }} -f ${dockerfilePath} ${buildContext}`;

        this.workspaceEdit.replace(this.fileUri, runSymbol.result.range, `run: ${runCommand}`);
        return { succeeded: true, result: undefined };
    }

    /**
     * Gets a symbol from a specified symbol collection (either the entire document or a subset of it) based on a path.
     * For example, if the YAML represented by the `symbols` value looks like this:
     * ```yaml
     * jobs:
     *  deploy:
     *   steps:
     *   - run: helm upgrade --wait
     * ```
     * Then `getSymbolFromProperties(symbols, "jobs", "deploy", "steps")` will return the symbol for the `steps` property.
     */
    protected getSymbolFromProperties(symbols: DocumentSymbol[], ...pathParts: string[]): Errorable<DocumentSymbol> {
        let currentSymbols = symbols;
        let foundSymbol = undefined;
        const currentPathParts = [];
        for (const part of pathParts) {
            currentPathParts.push(part);
            foundSymbol = currentSymbols.find((s) => s.name === part);
            if (!foundSymbol) {
                break;
            }
            currentSymbols = foundSymbol.children;
        }

        if (!foundSymbol) {
            return { succeeded: false, error: `Failed to find '${currentPathParts.join(".")}' symbol` };
        }

        return { succeeded: true, result: foundSymbol };
    }
}
