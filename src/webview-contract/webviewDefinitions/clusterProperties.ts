import { KubernetesVersionListResult } from "@azure/arm-containerservice";
import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string;
}

export type ClusterInfo = {
    provisioningState: string;
    fqdn: string;
    kubernetesVersion: string;
    powerStateCode: string;
    agentPoolProfiles: AgentPoolProfileInfo[];
    kubernetesVersionClusterInfo: KubernetesVersionListResult;
};

export type AgentPoolProfileInfo = {
    name: string;
    nodeImageVersion: string;
    powerStateCode: string;
    osDiskSizeGB: number;
    provisioningState: string;
    vmSize: string;
    count: number;
    osType: string;
};

export type ToVsCodeMsgDef = {
    getPropertiesRequest: void;
    stopClusterRequest: void;
    startClusterRequest: void;
    abortAgentPoolOperation: string;
    abortClusterOperation: void;
    reconcileClusterRequest: void;
};

export type ToWebViewMsgDef = {
    getPropertiesResponse: ClusterInfo;
    errorNotification: string;
};

export type ClusterPropertiesDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
