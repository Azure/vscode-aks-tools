import { GenerationLanguage, GenerationManifestType } from "@azure/arm-devhub";
// Define the initial state passed to the webview
export interface InitialState {
    repos: string[];
}

export type InitialSelection = {
    subscriptionId?: string;
};

export interface ResourceGroup {
    name: string;
    location: string;
}

export type AcrKey = {
    acrName: string;
    acrResourceGroup: string;
    acrSubscriptionId: string;
};

export interface BranchParams {
    repoOwner: string;
    repo: string;
}

export interface RepoKey extends BranchParams {
    branchName: string;
}

export type ClusterKey = {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
};

export type DockerfileKey = {
    appLanguage: GenerationLanguage;
    languageVersion: string;
    appPort: string;
    dockerfileBuildContextPath: string;
    dockerfilePath: string;
};

export type DeploymentKey = {
    deploymentType: GenerationManifestType;
    deploymentFileLocations: string[];
    appName: string;
    imageName: string;
    imageTag: string;
};

export type CreationFlags = {
    //Acr
    createNewAcr: boolean;
    createNewAcrResourceGroup: boolean;

    createNewNamespace: boolean;
    createNewClusterResourceGroup: boolean;

    //Flags for DevHub Call
    createNewDeploymentFiles: boolean;
    createNewDockerfile: boolean;
};

export type WorkflowCreationParams = {
    ClusterKey: ClusterKey;
    GitRepoKey: RepoKey;
    AcrKey: AcrKey;
    CreationFlags: CreationFlags;
    DeploymentKey: DeploymentKey;
    DockerfileKey: DockerfileKey;

    namespace: string;
    workflowName: string;
    location: string;
};
