import { AzExtParentTreeItem, AzureTreeItem } from "vscode-azureextensionui";

export default class AkClusterTreeItem extends AzureTreeItem {
    constructor(
        parent: AzExtParentTreeItem,
        name: string) {
            super(parent);

            /*
            this.iconPath = {
                dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'identity.svg'),
                light: path.join(__filename, '..', '..', '..', 'resources', 'light', 'identity.svg')
            };
            */

            this.id = name;
        }

    public readonly contextValue: string = 'aksCluster';

    public get label(): string {
        return this.id || '';
    }
}
