import * as fs from "fs/promises";
import { getAssetContext } from "../../../../assets";
import { ClusterPreference } from "../../types";
import { Errorable } from "../../../../commands/utils/errorable";
import { createTempFileWithPrefix, TempFile } from "../../../../commands/utils/tempfile";

export class RecentCluster {
    private static readonly RECENT_CLUSTER_FILEPATH_KEY = "recent-cluster-file-path";
    private static recentClusterTempFile?: TempFile;

    public static async saveRecentCluster(cluster: ClusterPreference): Promise<Errorable<boolean>> {
        const asset = getAssetContext();
        if (!asset) {
            return { succeeded: false, error: "Cannot save current cluster" };
        }

        // Save cluster to JSON temp file
        this.recentClusterTempFile = await createTempFileWithPrefix(JSON.stringify(cluster), "json", "current-cluster");

        // Save file path to global state
        asset.globalState.update(this.RECENT_CLUSTER_FILEPATH_KEY, this.recentClusterTempFile.filePath);

        return { succeeded: true, result: true };
    }

    public static async getRecentCluster(): Promise<Errorable<ClusterPreference>> {
        const asset = getAssetContext();
        if (!asset) {
            return { succeeded: false, error: "Current cluster not found." };
        }

        const filePath = asset.globalState.get(this.RECENT_CLUSTER_FILEPATH_KEY) as string;
        if (!filePath) {
            return { succeeded: false, error: "Cluster file path not found." };
        }

        // Read cluster information from JSON temp file
        try {
            const fileContent = await fs.readFile(filePath, "utf-8");
            const recentCluster = JSON.parse(fileContent) as ClusterPreference;
            return { succeeded: true, result: recentCluster };
        } catch {
            return { succeeded: false, error: "Failed to read recent cluster data." };
        }
    }

    public static doesRecentlyUsedClusterExist(): boolean {
        return !!this.recentClusterTempFile;
    }
}
