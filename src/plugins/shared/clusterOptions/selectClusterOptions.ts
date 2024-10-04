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
    NewCluster = "NewCluster"
}

export type QuickPickClusterOptions = QuickPickItem & { type: SelectClusterOptions }

const getClusterOptions = () => {
    const options = [
        {
            label: "", //seperator
            type: SelectClusterOptions.RecentCluster
        },
        {
            label: "Recently used cluster",
            type: SelectClusterOptions.RecentCluster
        },
        {
            label: "Existing cluster from your subscription",
            type: SelectClusterOptions.ExistingCluster
        },
        {
            label: "Create new cluster from AKS VS Extension",
            type: SelectClusterOptions.NewCluster
        }
    ];

    return options;
}

export async function selectClusterOptions(sessionProvider: ReadyAzureSessionProvider, exclude?: SelectClusterOptions[]): Promise<Errorable<ClusterPreference | boolean>> {
    const options = getClusterOptions();

    let doesRecentClusterExist = false;
    try {
        doesRecentClusterExist = await RecentCluster.doesRecentlyUsedClusterExist();
    } catch (error) {
        // do nothing if recent cluster does not exist, we do not show this option
    }

    let recentCluster: Errorable<ClusterPreference> | undefined;

    if (!doesRecentClusterExist) {
        options.splice(0, 2); // remove recently used options w/ seperator
    } else {
        recentCluster = await RecentCluster.getRecentCluster();
    }

    if (exclude && exclude.length > 0) {
        for (let i = options.length - 1; i >= 0; i--) {
            if (exclude.includes(options[i].type)) {
                options.splice(i, 1);
            }
        }
    }

    if (exclude && exclude.length > 0) {
        for (let i = options.length - 1; i >= 0; i--) {
            if (exclude.includes(options[i].type)) {
                options.splice(i, 1);
            }
        }
    }

    const quickPickClusterOptions: QuickPickClusterOptions[] = options.map((option) => {

        if (option.type === SelectClusterOptions.RecentCluster && doesRecentClusterExist) {
            return {
                label: option.label === "" ? `${recentCluster &&  recentCluster.succeeded ? recentCluster.result.clusterName : ""}` : option.label,
                type: option.type,
                kind: option.label === "" ? QuickPickItemKind.Separator : QuickPickItemKind.Default,
            }
        }

        return {
            label: option.label,
            type: option.type,
        };
    });

    const selectedOption = await window.showQuickPick(quickPickClusterOptions, {
        canPickMany: false,
        placeHolder: "Select option",
    });


    if (!selectedOption) {
        return { succeeded: false, error: "Cluster option not selected." };
    }

    switch(selectedOption.type) {
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