import * as fs from "fs/promises";
import { getAssetContext } from "../../../../assets";
import { ClusterPreference } from "../../types";
import { Errorable } from "../../../../commands/utils/errorable";
import { createTempFile, TempFile } from "../../../../commands/utils/tempfile";

export class RecentCluster {
    private static RECENT_CLUSTER_FILEPATH_KEY = "recent-cluster-file-path";
    private static RECENT_CLUSTER_TEMPFILE: TempFile | undefined = undefined;

    public static async saveRecentCluster(cluster: ClusterPreference): Promise<Errorable<boolean>> {
        const asset = getAssetContext();

        // save cluster to JSON temp file
        this.RECENT_CLUSTER_TEMPFILE = await createTempFile(JSON.stringify(cluster), "json", "current-cluster");

        if (!asset) {
            return { succeeded: false, error: "Cannot save current cluster" };
        }

        // save filepath to global state
        asset.globalState.update(this.RECENT_CLUSTER_FILEPATH_KEY, this.RECENT_CLUSTER_TEMPFILE.filePath);

        return { succeeded: true, result: true };
    }

    public static async getRecentCluster(): Promise<Errorable<ClusterPreference>> {
        const asset = getAssetContext();

        if (!asset) {
            return { succeeded: false, error: "Current cluster not found." };
        }

        const filePath = asset.globalState.get(this.RECENT_CLUSTER_FILEPATH_KEY) as string;

        // get cluster information from JSON temp file
        const fileContent = await fs.readFile(filePath, "utf-8");

        // parse JSON content for recent cluster
        const recentCluster = JSON.parse(fileContent) as ClusterPreference;

        return { succeeded: true, result: recentCluster };
    }

    public static async doesRecentlyUsedClusterExist(): Promise<boolean> {
        if (RecentCluster.RECENT_CLUSTER_TEMPFILE === undefined) {
            return false;
        }
        
        return true;
    }
}