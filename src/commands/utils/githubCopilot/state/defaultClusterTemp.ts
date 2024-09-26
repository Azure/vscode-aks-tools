import * as fs from "fs/promises";
import { getAssetContext } from "../../../../assets";
import { ClusterPreference } from "../../../../plugins/shared/types";
import { Errorable } from "../../errorable";
import { createTempFile, TempFile } from "../../tempfile";

export class DefaultClusterTemp {
    private static DEAFULT_CLUSTER_FILEPATH_KEY = "default-cluster-file-path";
    private static DEFAULT_CLUSTER_TEMPFILE: TempFile | undefined = undefined;

    public static async saveDefaultCluster(cluster: ClusterPreference): Promise<Errorable<boolean>> {
        const asset = getAssetContext();

        // save cluster to JSON temp file
        this.DEFAULT_CLUSTER_TEMPFILE = await createTempFile(JSON.stringify(cluster), "json", "current-cluster");

        if (!asset) {
            return { succeeded: false, error: "Cannot save current cluster" };
        }

        // save filepath to global state
        asset.globalState.update(this.DEAFULT_CLUSTER_FILEPATH_KEY, this.DEFAULT_CLUSTER_TEMPFILE.filePath);

        return { succeeded: true, result: true };
    }

    public static async getDefaultCluster(): Promise<Errorable<ClusterPreference>> {
        const asset = getAssetContext();

        if (!asset) {
            return { succeeded: false, error: "Current cluster not found." };
        }

        const filePath = asset.globalState.get(this.DEAFULT_CLUSTER_FILEPATH_KEY) as string;

        // get cluster information from JSON temp file
        const fileContent = await fs.readFile(filePath, "utf-8");

        // parse JSON content for default cluster
        const defaultCluster = JSON.parse(fileContent) as ClusterPreference;

        return { succeeded: true, result: defaultCluster };
    }

    public static async doesTempClusterExist(): Promise<boolean> {
        if (DefaultClusterTemp.DEFAULT_CLUSTER_TEMPFILE === undefined) {
            return false;
        }
        
        return true;
    }
}