import { ClusterPreference } from "../../types";
import { Errorable, failed } from "../../../../commands/utils/errorable";
import { RecentCluster } from "../state/recentCluster";

export async function selectRecentClusterOption(): Promise<Errorable<ClusterPreference>> {
    const currentCluster = await RecentCluster.getRecentCluster();

    return failed(currentCluster)
        ? { succeeded: false, error: currentCluster.error }
        : { succeeded: true, result: currentCluster.result };
}
