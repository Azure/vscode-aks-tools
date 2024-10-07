import { QuickPickItem, QuickPickItemKind, window } from "vscode";
import { ReadyAzureSessionProvider } from "../../../auth/types";
import { ClusterPreference } from "../types";
import { Errorable } from "../../../commands/utils/errorable";
import { RecentCluster } from "./state/recentCluster";
import { selectExistingClusterOption } from "./options/selectExistingClusterOption";
import { selectNewClusterOption } from "./options/selectNewClusterOption";
import { selectRecentClusterOption } from "./options/selectRecentClusterOption";

export enum SelectClusterOptions {
    RecentCluster = "RecentCluster",
    ExistingCluster = "ExistingCluster",
    NewCluster = "NewCluster",
}

export type QuickPickClusterOptions = QuickPickItem & { type: SelectClusterOptions };

const getClusterOptions = (): { label: string; type: SelectClusterOptions }[] => [
    { label: "", type: SelectClusterOptions.RecentCluster }, // Separator
    { label: "Recently used cluster", type: SelectClusterOptions.RecentCluster },
    { label: "Existing cluster from your subscription", type: SelectClusterOptions.ExistingCluster },
    { label: "Create new cluster from AKS VS Extension", type: SelectClusterOptions.NewCluster },
];

export async function selectClusterOptions(
    sessionProvider: ReadyAzureSessionProvider,
    exclude?: SelectClusterOptions[],
): Promise<Errorable<ClusterPreference | boolean>> {
    const options = getClusterOptions();
    let recentCluster: Errorable<ClusterPreference> | undefined;

    try {
        if (await RecentCluster.doesRecentlyUsedClusterExist()) {
            recentCluster = await RecentCluster.getRecentCluster();
        } else {
            options.splice(0, 2); // Remove recent cluster options and separator
        }
    } catch {
        // Ignore error if recent cluster does not exist
    }

    // Exclude specified cluster types if needed
    if (exclude?.length) {
        for (let i = options.length - 1; i >= 0; i--) {
            if (exclude.includes(options[i].type)) {
                options.splice(i, 1);
            }
        }
    }

    const quickPickClusterOptions: QuickPickClusterOptions[] = options.map((option) => {
        const isRecentCluster = option.type === SelectClusterOptions.RecentCluster;
        const isSeperator = option.label === "";
        const label = isSeperator && isRecentCluster && recentCluster?.succeeded ? recentCluster.result.clusterName : option.label;
  
        return {
            label,
            type: option.type,
            kind: isSeperator ? QuickPickItemKind.Separator : QuickPickItemKind.Default,
        };
    });

    const selectedOption = await window.showQuickPick(quickPickClusterOptions, {
        canPickMany: false,
        placeHolder: "Select option",
    });

    if (!selectedOption) {
        return { succeeded: false, error: "Cluster option not selected." };
    }

    switch (selectedOption.type) {
        case SelectClusterOptions.RecentCluster:
            return await selectRecentClusterOption();
        case SelectClusterOptions.ExistingCluster:
            return await selectExistingClusterOption(sessionProvider);
        case SelectClusterOptions.NewCluster:
            return await selectNewClusterOption();
        default:
            return { succeeded: false, error: "Invalid cluster option selected." };
    }
}
