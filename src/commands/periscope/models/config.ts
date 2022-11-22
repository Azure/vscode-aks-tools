export interface KustomizeConfig {
    repoOrg: string;
    containerRegistry: string;
    releaseTag: string;
    imageVersion: string;
}

export interface KubeloginConfig {
    releaseTag: string;
 }
