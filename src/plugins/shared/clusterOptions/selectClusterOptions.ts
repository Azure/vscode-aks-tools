import { QuickPickItem, QuickPickItemKind, window } from "vscode";
import { ReadyAzureSessionProvider } from "../../../auth/types";
import { ClusterPreference } from "../types";
import { Errorable } from "../../../commands/utils/errorable";
import { RecentCluster } from "./state/recentCluster";
import { selectExistingClusterOption } from "./options/selectExistingClusterOption";
import { selectNewClusterOption } from "./options/selectNewClusterOption";
import { selectRecentClusterOption } from "./options/selectRecentClusterOption";

enum Options {
    RecentCluster = "RecentCluster",
    ExistingCluster = "ExistingCluster",
    NewCluster = "NewCluster"
}

export type QuickPickClusterOptions = QuickPickItem & { type: Options }

const getClusterOptions = () => {
    const options = [
        {
            label: "", //seperator
            type: Options.RecentCluster
        },
        {
            label: "Recently used cluster",
            type: Options.RecentCluster
        },
        {
            label: "Existing cluster from your subscription",
            type: Options.ExistingCluster
        },
        {
            label: "Create new cluster from AKS VS Extension",
            type: Options.NewCluster
        }
    ];

    return options;
}

export async function selectClusterOptions(sessionProvider: ReadyAzureSessionProvider): Promise<Errorable<ClusterPreference | boolean>> {
    const options = getClusterOptions();

    const doesTempClusterExist = await RecentCluster.doesTempClusterExist();
    let defaultCluster: Errorable<ClusterPreference> | undefined;

    if (!doesTempClusterExist) {
        options.splice(0, 2); // remove recently used options w/ seperator
    } else {
        defaultCluster = await RecentCluster.getRecentCluster();
    }

    const quickPickClusterOptions: QuickPickClusterOptions[] = options.map((option) => {

        if (option.type === Options.RecentCluster && doesTempClusterExist) {
            return {
                label: option.label === "" ? `${defaultCluster &&  defaultCluster.succeeded ? defaultCluster.result.clusterName : ""}` : option.label,
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

    if (selectedOption.type === Options.RecentCluster) {
        return await selectRecentClusterOption();

    } else if (selectedOption.type === Options.ExistingCluster) {
        return await selectExistingClusterOption(sessionProvider);

    } else if (selectedOption.type === Options.NewCluster) {
        return await selectNewClusterOption();

    } else {
        return { succeeded: false, error: "Invalid cluster option selected." };
    }
}
