import { ClusterPreference } from "../../../../../plugins/shared/types";
import { Errorable, failed } from "../../../errorable";
import { DefaultClusterTemp } from "../../state/defaultClusterTemp";

export async function selectDefaultClusterOption(): Promise<Errorable<ClusterPreference>> {
    const currentCluster = await DefaultClusterTemp.getDefaultCluster();

    if(failed(currentCluster)) {
        return { succeeded: false, error: currentCluster.error };
    }

    return { succeeded: true, result: currentCluster.result };
}