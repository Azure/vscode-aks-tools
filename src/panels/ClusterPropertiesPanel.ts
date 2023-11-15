import { Uri } from "vscode";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { AgentPoolProfileInfo, ClusterInfo, InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/clusterProperties";
import { ContainerServiceClient, ManagedCluster, ManagedClusterAgentPoolProfile } from "@azure/arm-containerservice";
import { getManagedCluster } from "../commands/utils/clusters";

export class ClusterPropertiesPanel extends BasePanel<"clusterProperties"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "clusterProperties", {
            getPropertiesResponse: null,
            errorNotification: null
        });
    }
}

export class ClusterPropertiesDataProvider implements PanelDataProvider<"clusterProperties"> {
    constructor(
        readonly client: ContainerServiceClient,
        readonly resourceGroup: string,
        readonly clusterName: string
    ) { }

    getTitle(): string {
        return `Cluster Properties for ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getPropertiesRequest: () => this._handleGetPropertiesRequest(webview),
            stopClusterRequest: () => this._handleStopClusterRequest(webview),
            startClusterRequest: () => this._handleStartClusterRequest(webview),
            abortAgentPoolOperation: (poolName: string) => this._handleAbortAgentPoolOperation(webview, poolName)
        };
    }

    private async _handleAbortAgentPoolOperation(webview: MessageSink<ToWebViewMsgDef>, poolName: string) {
        try {
            await this._readAndPostClusterProperties(webview);
            const poller = await this.client.agentPools.beginAbortLatestOperation(this.resourceGroup, this.clusterName, poolName);

            poller.onProgress(state => {
                if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this._readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }
    }

    private async _handleGetPropertiesRequest(webview: MessageSink<ToWebViewMsgDef>) {
        await this._readAndPostClusterProperties(webview);
    }

    private async _handleStopClusterRequest(webview: MessageSink<ToWebViewMsgDef>) {
        try {
            const poller = await this.client.managedClusters.beginStop(this.resourceGroup, this.clusterName);

            poller.onProgress(state => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(`Stop Cluster operation on ${this.clusterName} was cancelled.`);
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this._readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }

        await this._readAndPostClusterProperties(webview);
    }

    private async _handleStartClusterRequest(webview: MessageSink<ToWebViewMsgDef>) {
        try {
            const poller = await this.client.managedClusters.beginStart(this.resourceGroup, this.clusterName);

            poller.onProgress(state => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(`Start Cluster operation on ${this.clusterName} was cancelled.`);
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this._readAndPostClusterProperties(webview);

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        }

        await this._readAndPostClusterProperties(webview);
    }

    private async _readAndPostClusterProperties(webview: MessageSink<ToWebViewMsgDef>) {
        const cluster = await getManagedCluster(this.client, this.resourceGroup, this.clusterName);
        if (failed(cluster)) {
            webview.postErrorNotification(cluster.error);
            return;
        }

        webview.postGetPropertiesResponse(asClusterInfo(cluster.result));
    }
}

function asClusterInfo(cluster: ManagedCluster): ClusterInfo {
    return {
        provisioningState: cluster.provisioningState!,
        fqdn: cluster.fqdn!,
        kubernetesVersion: cluster.kubernetesVersion!,
        powerStateCode: cluster.powerState!.code!,
        agentPoolProfiles: (cluster.agentPoolProfiles || []).map(asPoolProfileInfo)
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
        osType: pool.osType!
    };
}
