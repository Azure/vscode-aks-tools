import { l10n, Uri } from "vscode";
import { Errorable, failed, getErrorMessage } from "../commands/utils/errorable";
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
    ManagedClusterUpgradeProfile,
} from "@azure/arm-containerservice";
import { getKubernetesVersionInfo, getManagedCluster, getClusterUpgradeProfile } from "../commands/utils/clusters";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { getAksClient } from "../commands/utils/arm";
import { ReadyAzureSessionProvider } from "../auth/types";
import { aksCRUDDiagnostics } from "../commands/detectors/detectors";
import { IActionContext } from "@microsoft/vscode-azext-utils";

export class ClusterPropertiesPanel extends BasePanel<"clusterProperties"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "clusterProperties", {
            getPropertiesResponse: null,
            propertiesRequestComplete: null,
            clusterOperationResponse: null,
            errorNotification: null,
            upgradeClusterVersionResponse: null,
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
        readonly target: unknown,
    ) {
        this.client = getAksClient(sessionProvider, subscriptionId);
    }

    getTitle(): string {
        return l10n.t(`Cluster Properties for {0}`, this.clusterName);
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
            upgradeClusterVersionRequest: true,
            detectorCRUDRequest: true,
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
            upgradeClusterVersionRequest: (version: string) => this.handleUpgradeClusterVersion(webview, version),
            detectorCRUDRequest: () => this.handleDetectorCRUDRequest(this.target),
        };
    }

    private async handleAbortAgentPoolOperation(webview: MessageSink<ToWebViewMsgDef>, poolName: string) {
        let requestCompleted = false;
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
            webview.postClusterOperationResponse();
            requestCompleted = true;

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        } finally {
            if (!requestCompleted) {
                webview.postClusterOperationResponse();
            }
        }
    }

    private async handleAbortClusterOperation(webview: MessageSink<ToWebViewMsgDef>) {
        let requestCompleted = false;
        try {
            const poller = await this.client.managedClusters.beginAbortLatestOperation(
                this.resourceGroup,
                this.clusterName,
            );

            poller.onProgress((state) => {
                // Note: not handling 'canceled' here because this is a cancel operation.
                if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : l10n.t("Unknown error");
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);
            webview.postClusterOperationResponse();
            requestCompleted = true;

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        } finally {
            if (!requestCompleted) {
                webview.postClusterOperationResponse();
            }
        }
    }

    private async handleReconcileClusterOperation(webview: MessageSink<ToWebViewMsgDef>) {
        let requestCompleted = false;
        try {
            const getClusterInfo = await this.client.managedClusters.get(this.resourceGroup, this.clusterName);
            const poller = await this.client.managedClusters.beginCreateOrUpdate(this.resourceGroup, this.clusterName, {
                location: getClusterInfo.location,
            });

            poller.onProgress((state) => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(
                        l10n.t(`Reconcile Cluster operation on {0} was cancelled.`, this.clusterName),
                    );
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : l10n.t("Unknown error");
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);
            webview.postClusterOperationResponse();
            requestCompleted = true;

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        } finally {
            if (!requestCompleted) {
                webview.postClusterOperationResponse();
            }
        }
    }

    private async handleGetPropertiesRequest(webview: MessageSink<ToWebViewMsgDef>) {
        try {
            await this.readAndPostClusterProperties(webview);
        } catch (ex) {
            webview.postErrorNotification(getErrorMessage(ex));
        } finally {
            webview.postPropertiesRequestComplete();
        }
    }

    private async handleStopClusterRequest(webview: MessageSink<ToWebViewMsgDef>) {
        let requestCompleted = false;
        try {
            const poller = await this.client.managedClusters.beginStop(this.resourceGroup, this.clusterName);

            poller.onProgress((state) => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(
                        l10n.t(`Stop Cluster operation on {0} was cancelled.`, this.clusterName),
                    );
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : l10n.t("Unknown error");
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);
            webview.postClusterOperationResponse();
            requestCompleted = true;

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        } finally {
            if (!requestCompleted) {
                webview.postClusterOperationResponse();
            }
        }

        await this.readAndPostClusterProperties(webview);
    }

    private async handleStartClusterRequest(webview: MessageSink<ToWebViewMsgDef>) {
        let requestCompleted = false;
        try {
            const poller = await this.client.managedClusters.beginStart(this.resourceGroup, this.clusterName);

            poller.onProgress((state) => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(
                        l10n.t(`Start Cluster operation on {0} was cancelled.`, this.clusterName),
                    );
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : l10n.t("Unknown error");
                    webview.postErrorNotification(errorMessage);
                }
            });

            // Update the cluster properties now the operation has started.
            await this.readAndPostClusterProperties(webview);
            webview.postClusterOperationResponse();
            requestCompleted = true;

            // Wait until operation completes.
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
        } finally {
            if (!requestCompleted) {
                webview.postClusterOperationResponse();
            }
        }

        await this.readAndPostClusterProperties(webview);
    }

    private async handleUpgradeClusterVersion(webview: MessageSink<ToWebViewMsgDef>, version: string) {
        let requestCompleted = false;
        try {
            const cluster = await getManagedCluster(
                this.sessionProvider,
                this.subscriptionId,
                this.resourceGroup,
                this.clusterName,
            );

            if (failed(cluster)) {
                webview.postErrorNotification(cluster.error);
                webview.postUpgradeClusterVersionResponse(false);
                return;
            }

            // Create update parameters, preserving all other properties
            const updateParams: ManagedCluster = {
                ...cluster.result,
                kubernetesVersion: version,
            };

            const poller = await this.client.managedClusters.beginCreateOrUpdate(
                this.resourceGroup,
                this.clusterName,
                updateParams,
            );

            poller.onProgress((state) => {
                if (state.status === "canceled") {
                    webview.postErrorNotification(l10n.t(`Upgrade operation on {0} was cancelled.`, this.clusterName));
                    webview.postUpgradeClusterVersionResponse(false);
                    return;
                } else if (state.status === "failed") {
                    const errorMessage = state.error ? getErrorMessage(state.error) : l10n.t("Unknown error");
                    webview.postErrorNotification(errorMessage);
                    webview.postUpgradeClusterVersionResponse(false);
                    return;
                }
            });

            // Update the cluster properties now that the operation has started
            await this.readAndPostClusterProperties(webview);
            webview.postClusterOperationResponse();
            requestCompleted = true;

            // Wait until operation completes
            await poller.pollUntilDone();
            webview.postUpgradeClusterVersionResponse(true);
        } catch (ex) {
            const errorMessage = getErrorMessage(ex);
            webview.postErrorNotification(errorMessage);
            webview.postUpgradeClusterVersionResponse(false);
        } finally {
            if (!requestCompleted) {
                webview.postClusterOperationResponse();
            }
        }

        // Refresh the cluster properties after operation completes
        await this.readAndPostClusterProperties(webview);
    }

    private handleDetectorCRUDRequest(commandTarget: unknown) {
        // This is a placeholder for the CRUD operation
        // Implement the CRUD logic here
        return aksCRUDDiagnostics({} as IActionContext, commandTarget);
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

        await postClusterProperties(
            webview,
            cluster.result,
            () => getKubernetesVersionInfo(this.client, cluster.result.location),
            () => getClusterUpgradeProfile(this.client, this.resourceGroup, this.clusterName),
        );
    }
}

export async function postClusterProperties(
    webview: MessageSink<ToWebViewMsgDef>,
    cluster: ManagedCluster,
    getKubernetesVersions: () => Promise<Errorable<KubernetesVersionListResult>>,
    getUpgradeProfile: () => Promise<Errorable<ManagedClusterUpgradeProfile>>,
): Promise<void> {
    const [kubernetesVersions, upgradeProfile] = await Promise.all([
        getKubernetesVersions().catch((error): Errorable<KubernetesVersionListResult> => ({
            succeeded: false,
            error: getErrorMessage(error),
        })),
        getUpgradeProfile().catch((error): Errorable<ManagedClusterUpgradeProfile> => ({
            succeeded: false,
            error: getErrorMessage(error),
        })),
    ]);
    const versionList = failed(kubernetesVersions) ? undefined : kubernetesVersions.result;
    const profile = failed(upgradeProfile) ? undefined : upgradeProfile.result;

    // Upgrade metadata is useful but should never prevent the core cluster properties from loading.
    webview.postGetPropertiesResponse(asClusterInfo(cluster, versionList, profile));

    const errors: string[] = [];
    if (failed(kubernetesVersions)) {
        errors.push(kubernetesVersions.error);
    }
    if (failed(upgradeProfile)) {
        errors.push(upgradeProfile.error);
    }
    if (errors.length > 0) {
        webview.postErrorNotification(
            l10n.t("Some Kubernetes version and upgrade information could not be loaded: {0}", errors.join("\n")),
        );
    }
}

export function asClusterInfo(
    cluster: ManagedCluster,
    kubernetesVersionList?: KubernetesVersionListResult,
    upgradeProfile?: ManagedClusterUpgradeProfile,
): ClusterInfo {
    return {
        provisioningState: cluster.provisioningState ?? "Unknown",
        fqdn: cluster.fqdn ?? "Unknown",
        kubernetesVersion: cluster.currentKubernetesVersion ?? cluster.kubernetesVersion ?? "Unknown",
        powerStateCode: cluster.powerState?.code ?? "Unknown",
        agentPoolProfiles: (cluster.agentPoolProfiles || []).map(asPoolProfileInfo),
        supportedVersions: (kubernetesVersionList?.values || []).map(asKubernetesVersionInfo),
        availableUpgradeVersions: processAndSortUpgradeVersions(upgradeProfile?.controlPlaneProfile?.upgrades || []),
    };
}

function processAndSortUpgradeVersions(upgrades: Array<{ kubernetesVersion?: string }>): string[] {
    return (
        upgrades
            .map((upgrade) => upgrade.kubernetesVersion!)
            .filter((version): version is string => version !== undefined)
            // Sort versions in descending order (highest to lowest)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }))
    );
}

function asPoolProfileInfo(pool: ManagedClusterAgentPoolProfile): AgentPoolProfileInfo {
    return {
        name: pool.name,
        nodeImageVersion: pool.nodeImageVersion ?? "Unknown",
        powerStateCode: pool.powerState?.code ?? "Unknown",
        osDiskSizeGB: pool.osDiskSizeGB ?? null,
        provisioningState: pool.provisioningState ?? "Unknown",
        vmSize: pool.vmSize ?? "Unknown",
        count: pool.count ?? null,
        osType: pool.osType ?? "Unknown",
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
