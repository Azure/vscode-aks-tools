import * as k8s from "vscode-kubernetes-tools-api";
import * as vscode from "vscode";
import { Errorable } from "../commands/utils/errorable";

export class AzureResourceNodeContributor implements k8s.ClusterExplorerV1.NodeContributor {
    constructor(
        private readonly explorer: k8s.ClusterExplorerV1,
        private readonly kubectl: k8s.KubectlV1,
    ) {}

    contributesChildren(parent?: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined): boolean {
        return parent?.nodeType === "context";
    }

    async getChildren(
        parent: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined,
    ): Promise<k8s.ClusterExplorerV1.Node[]> {
        if (parent === undefined) {
            return [];
        }

        return [new AzureServicesFolderNode(this.explorer, this.kubectl)];
    }
}

class AzureServicesFolderNode implements k8s.ClusterExplorerV1.Node {
    constructor(
        private readonly explorer: k8s.ClusterExplorerV1,
        private readonly kubectl: k8s.KubectlV1,
    ) {}

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        const crdTypes = await getAzureServiceResourceTypes(this.kubectl);
        if (!crdTypes.succeeded) {
            vscode.window.showErrorMessage(`Unable to retrieve Azure Services resources: ${crdTypes.error}.`);
            return [];
        }

        // Map the custom resource definitions into NodeSources that the K8s extension knows how to turn into nodes.
        const nodeSources = crdTypes.result.map((t) =>
            this.explorer.nodeSources.resourceFolder(
                t.displayName,
                t.pluralDisplayName,
                t.manifestKind,
                t.abbreviation,
            ),
        );

        // Turn the NodeSources into nodes.
        const nodes = (await Promise.all(nodeSources.map((ns) => ns.nodes()))).flat();
        return nodes;
    }

    getTreeItem(): vscode.TreeItem {
        return new vscode.TreeItem("Azure Services", vscode.TreeItemCollapsibleState.Collapsed);
    }
}

interface CustomResource {
    readonly name: string;
    readonly displayName: string;
    readonly pluralDisplayName: string;
    readonly manifestKind: string;
    readonly abbreviation: string;
}

async function getAzureServiceResourceTypes(kubectl: k8s.KubectlV1): Promise<Errorable<CustomResource[]>> {
    // Some kubectl versions discard everything after a null/missing value within a jsonpath `range`,
    // meaning trailing newlines get omitted from the output and we can't split lines correctly.
    // For this reason, we make the newline the *first* component of the range, and ensure the value
    // which might be null (shortNames[0] in this case) is right at the end.
    // This means we end up with a blank line at the start of the output, but it's otherwise consistent.
    const command = `get crd -o jsonpath="{range .items[*]}{\\"\\n\\"}{.metadata.name}{\\" \\"}{.spec.names.kind}{\\" \\"}{.spec.names.singular}{\\" \\"}{.spec.names.plural}{\\" \\"}{.spec.names.shortNames[0]}{end}"`;
    const crdShellResult = await kubectl.invokeCommand(command);
    if (crdShellResult === undefined) {
        return { succeeded: false, error: `Failed to run kubectl command: ${command}` };
    }

    if (crdShellResult.code !== 0) {
        return {
            succeeded: false,
            error: `Kubectl returned error ${crdShellResult.code} for ${command}\nError: ${crdShellResult.stderr}`,
        };
    }

    const lines = crdShellResult.stdout.split("\n").filter((l) => l.length > 0);

    const customResources = lines.map((line) => {
        const parts = line.split(" ");
        const metadataName = parts[0];
        const kind = parts[1];
        const singularName = parts[2];
        const pluralName = parts[3];
        const shortName = parts[4];
        const abbreviation = shortName || metadataName;
        return {
            name: metadataName,
            displayName: singularName,
            pluralDisplayName: pluralName,
            manifestKind: kind,
            abbreviation,
        };
    });

    // Filter the custom resources to only include Azure resources
    const azureResources = customResources.filter((r) => r.name.includes("azure.com"));

    return { succeeded: true, result: azureResources };
}
