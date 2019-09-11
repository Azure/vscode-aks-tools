import { AzExtParentTreeItem, AzureTreeItem } from "vscode-azureextensionui";
import { Resource } from "azure-arm-storage/lib/models";

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

    public readonly contextValue: string = 'aksCluster';

    public get label(): string {
        return this.resource.name || '<unnamed resource>';
    }
}
