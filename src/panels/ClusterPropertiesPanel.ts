import { Uri } from "vscode";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import {
    AgentPoolProfileInfo,
    ClusterInfo,
    InitialState,
    KubernetesVersionInfo,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/clusterProperties";
import {
    ContainerServiceClient,
    KubernetesVersion,
    KubernetesVersionListResult,
    ManagedCluster,
    ManagedClusterAgentPoolProfile,
} from "@azure/arm-containerservice";
import { getKubernetesVersionInfo, getManagedCluster } from "../commands/utils/clusters";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { getAksClient } from "../commands/utils/arm";
import { ReadyAzureSessionProvider } from "../auth/types";

export class ClusterPropertiesPanel extends BasePanel<"clusterProperties"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "clusterProperties", {
            getPropertiesResponse: null,
            errorNotification: null,
        });
    }
}

export class ClusterPropertiesDataProvider implements PanelDataProvider<"clusterProperties"> {
    private readonly client: ContainerServiceClient;
    constructor(
        private readonly sessionProvider: ReadyAzureSessionProvider,
        readonly subscriptionId: string,
        readonly resourceGroup: string,
        readonly clusterName: string,
    ) {
        this.client = getAksClient(sessionProvider, subscriptionId);
    }

    getTitle(): string {
        return `Cluster Properties for ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"clusterProperties"> {
        return {
            getPropertiesRequest: false,
            stopClusterRequest: true,
            startClusterRequest: true,
            abortAgentPoolOperation: true,
            abortClusterOperation: true,
            reconcileClusterRequest: true,
            refreshRequest: true,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getPropertiesRequest: () => this.handleGetPropertiesRequest(webview),
            stopClusterRequest: () => this.handleStopClusterRequest(webview),
            startClusterRequest: () => this.handleStartClusterRequest(webview),
            abortAgentPoolOperation: (poolName: string) => this.handleAbortAgentPoolOperation(webview, poolName),
            abortClusterOperation: () => this.handleAbortClusterOperation(webview),
            reconcileClusterRequest: () => this.handleReconcileClusterOperation(webview),
            // refreshRequest is just for telemetry, so it will use the same getPropertiesRequest handler.
            refreshRequest: () => this.handleGetPropertiesRequest(webview),
        };
    }

    private async handleAbortAgentPoolOperation(webview: MessageSink<ToWebViewMsgDef>, poolName: string) {
        try {
            const poller = await this.client.agentPools.beginAbortLatestOperation(
                this.resourceGroup,
                this.clusterName,
                poolName,
            );

            poller.onProgress((state) => {
                // Note: not handling 'canceled' here because this is a cancel operation.
                if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }
    }

    private async handleAbortClusterOperation(webview: MessageSink<ToWebViewMsgDef>) {
        try {
            const poller = await this.client.managedClusters.beginAbortLatestOperation(
                this.resourceGroup,
                this.clusterName,
            );

            poller.onProgress((state) => {
                // Note: not handling 'canceled' here because this is a cancel operation.
                if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }
    }

    private async handleReconcileClusterOperation(webview: MessageSink<ToWebViewMsgDef>) {
        try {
            const getClusterInfo = await this.client.managedClusters.get(this.resourceGroup, this.clusterName);
            const poller = await this.client.managedClusters.beginCreateOrUpdate(this.resourceGroup, this.clusterName, {
                location: getClusterInfo.location,
            });

            poller.onProgress((state) => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(`Reconcile Cluster operation on ${this.clusterName} was cancelled.`);
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }
    }

    private async handleGetPropertiesRequest(webview: MessageSink<ToWebViewMsgDef>) {
        await this.readAndPostClusterProperties(webview);
    }

    private async handleStopClusterRequest(webview: MessageSink<ToWebViewMsgDef>) {
        try {
            const poller = await this.client.managedClusters.beginStop(this.resourceGroup, this.clusterName);

            poller.onProgress((state) => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(`Stop Cluster operation on ${this.clusterName} was cancelled.`);
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }

        await this.readAndPostClusterProperties(webview);
    }

    private async handleStartClusterRequest(webview: MessageSink<ToWebViewMsgDef>) {
        try {
            const poller = await this.client.managedClusters.beginStart(this.resourceGroup, this.clusterName);

            poller.onProgress((state) => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(`Start Cluster operation on ${this.clusterName} was cancelled.`);
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }

        await this.readAndPostClusterProperties(webview);
    }

    private async readAndPostClusterProperties(webview: MessageSink<ToWebViewMsgDef>) {
        const cluster = await getManagedCluster(
            this.sessionProvider,
            this.subscriptionId,
            this.resourceGroup,
            this.clusterName,
        );
        if (failed(cluster)) {
            webview.postErrorNotification(cluster.error);
            return;
        }

        const kubernetesVersion = await getKubernetesVersionInfo(this.client, cluster.result.location);
        if (failed(kubernetesVersion)) {
            webview.postErrorNotification(kubernetesVersion.error);
            return;
        }

        webview.postGetPropertiesResponse(asClusterInfo(cluster.result, kubernetesVersion.result));
    }
}

function asClusterInfo(cluster: ManagedCluster, kubernetesVersionList: KubernetesVersionListResult): ClusterInfo {
    return {
        provisioningState: cluster.provisioningState!,
        fqdn: cluster.fqdn!,
        kubernetesVersion: cluster.currentKubernetesVersion!,
        powerStateCode: cluster.powerState!.code!,
        agentPoolProfiles: (cluster.agentPoolProfiles || []).map(asPoolProfileInfo),
        supportedVersions: (kubernetesVersionList.values || []).map(asKubernetesVersionInfo),
    };
}

function asPoolProfileInfo(pool: ManagedClusterAgentPoolProfile): AgentPoolProfileInfo {
    return {
        name: pool.name,
        nodeImageVersion: pool.nodeImageVersion!,
        powerStateCode: pool.powerState!.code!,
        osDiskSizeGB: pool.osDiskSizeGB!,
        provisioningState: pool.provisioningState!,
        vmSize: pool.vmSize!,
        count: pool.count!,
        osType: pool.osType!,
    };
}

function asKubernetesVersionInfo(version: KubernetesVersion): KubernetesVersionInfo {
    return {
        version: version.version || "",
        patchVersions: version.patchVersions ? Object.keys(version.patchVersions) : [],
        supportPlan: version.capabilities ? Object.values(version.capabilities.supportPlan || {}) : [],
        isPreview: version.isPreview || false,
    };
}
