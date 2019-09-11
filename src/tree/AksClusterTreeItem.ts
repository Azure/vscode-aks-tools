import { AzExtParentTreeItem, AzureTreeItem } from "vscode-azureextensionui";
import { Resource } from "azure-arm-storage/lib/models";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";

export default class AkClusterTreeItem extends AzureTreeItem {
    constructor(
        parent: AzExtParentTreeItem,
        private readonly resource: Resource) {
            super(parent);

            /*
            this.iconPath = {
                dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'identity.svg'),
                light: path.join(__filename, '..', '..', '..', 'resources', 'light', 'identity.svg')
            };
            */

            this.id = this.resource.id;
        }

    public readonly contextValue: string = `aks.cluster ${CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`;

    public get label(): string {
        return this.resource.name || '<unnamed resource>';
    }

    public readonly nodeType: string = 'cluster';
}
