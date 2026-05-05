import { useEffect, useState } from "react";
import { vscode, KickstartState } from "./state";
import { Subscription, Cluster, Acr } from "../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { Pickers } from "./Pickers";
import { PermissionChecks } from "./PermissionChecks";
import { ActionBar } from "./ActionBar";
import * as l10n from "@vscode/l10n";

export function Kickstart() {
    const [state, setState] = useState<KickstartState>({
        subscriptions: [],
        selectedSub: null,
        resourceGroups: [],
        selectedRg: null,
        clusters: [],
        selectedCluster: null,
        acrs: [],
        selectedAcr: null,
        permissions: { loading: false },
    });

    function refreshPermissions(cluster: Cluster | null, acr: Acr | null) {
        if (cluster && acr) {
            setState((prev) => ({ ...prev, permissions: { loading: true } }));
            vscode.postGetPermissionStatusRequest({
                clusterKey: {
                    subscriptionId: cluster.subscriptionId,
                    resourceGroup: cluster.resourceGroup,
                    clusterName: cluster.clusterName,
                },
                acrKey: { subscriptionId: acr.subscriptionId, resourceGroup: acr.resourceGroup, acrName: acr.acrName },
            });
        } else {
            setState((prev) => ({ ...prev, permissions: { loading: false } }));
        }
    }

    useEffect(() => {
        const handler = {
            getSubscriptionsResponse: (args: { subscriptions: Subscription[] }) => {
                setState((prev) => ({ ...prev, subscriptions: args.subscriptions }));
            },
            getResourceGroupsResponse: (args: { subscriptionId: string; resourceGroups: string[] }) => {
                setState((prev) => ({ ...prev, resourceGroups: args.resourceGroups }));
            },
            getClustersResponse: (args: { key: { subscriptionId: string }; clusters: Cluster[] }) => {
                setState((prev) => ({ ...prev, clusters: args.clusters }));
            },
            getAcrsResponse: (args: { key: { subscriptionId: string }; acrs: Acr[] }) => {
                setState((prev) => ({ ...prev, acrs: args.acrs }));
            },
            getPermissionStatusResponse: (args: {
                hasAcrPull: boolean;
                attached: boolean;
                loading?: boolean;
                error?: string;
            }) => {
                setState((prev) => ({
                    ...prev,
                    permissions: {
                        hasAcrPull: args.hasAcrPull,
                        attached: args.attached,
                        loading: args.loading || false,
                        error: args.error,
                    },
                }));
            },
            attachAcrResponse: (args: { succeeded: boolean; error?: string }) => {
                setState((prev) => ({
                    ...prev,
                    permissions: {
                        ...prev.permissions,
                        loading: false,
                        error: args.error || (args.succeeded ? undefined : l10n.t("Failed to attach ACR")),
                    },
                }));
                if (args.succeeded) {
                    setState((prev) => {
                        if (prev.selectedCluster && prev.selectedAcr) {
                            vscode.postGetPermissionStatusRequest({
                                clusterKey: {
                                    subscriptionId: prev.selectedCluster.subscriptionId,
                                    resourceGroup: prev.selectedCluster.resourceGroup,
                                    clusterName: prev.selectedCluster.clusterName,
                                },
                                acrKey: {
                                    subscriptionId: prev.selectedAcr.subscriptionId,
                                    resourceGroup: prev.selectedAcr.resourceGroup,
                                    acrName: prev.selectedAcr.acrName,
                                },
                            });
                        }
                        return {
                            ...prev,
                            permissions: {
                                ...prev.permissions,
                                loading: Boolean(prev.selectedCluster && prev.selectedAcr),
                            },
                        };
                    });
                }
            },
            startKickstartResponse: () => {},
        };

        vscode.subscribeToMessages(handler);
    }, []);

    useEffect(() => {
        vscode.postGetSubscriptionsRequest();
    }, []);

    const handleSubChange = (sub: Subscription | null) => {
        setState((prev) => ({
            ...prev,
            selectedSub: sub,
            selectedRg: null,
            selectedCluster: null,
            selectedAcr: null,
            permissions: { loading: false },
        }));

        if (sub) {
            vscode.postGetResourceGroupsRequest({ subscriptionId: sub.subscriptionId });
            vscode.postGetClustersRequest({ subscriptionId: sub.subscriptionId });
            vscode.postGetAcrsRequest({ subscriptionId: sub.subscriptionId });
        }
    };

    const handleRgChange = (rg: string | null) => {
        setState((prev) => ({
            ...prev,
            selectedRg: rg,
            selectedCluster: null,
            selectedAcr: null,
            permissions: { loading: false },
        }));

        if (state.selectedSub) {
            vscode.postGetClustersRequest({
                subscriptionId: state.selectedSub.subscriptionId,
                resourceGroup: rg || undefined,
            });
            vscode.postGetAcrsRequest({
                subscriptionId: state.selectedSub.subscriptionId,
                resourceGroup: rg || undefined,
            });
        }
    };

    const handleClusterChange = (cluster: Cluster | null) => {
        setState((prev) => ({ ...prev, selectedCluster: cluster }));
        refreshPermissions(cluster, state.selectedAcr);
    };

    const handleAcrChange = (acr: Acr | null) => {
        setState((prev) => ({ ...prev, selectedAcr: acr }));
        refreshPermissions(state.selectedCluster, acr);
    };

    const handleAttach = () => {
        if (state.selectedCluster && state.selectedAcr) {
            setState((prev) => ({ ...prev, permissions: { ...prev.permissions, loading: true } }));
            vscode.postAttachAcrRequest({
                clusterKey: {
                    subscriptionId: state.selectedCluster.subscriptionId,
                    resourceGroup: state.selectedCluster.resourceGroup,
                    clusterName: state.selectedCluster.clusterName,
                },
                acrKey: {
                    subscriptionId: state.selectedAcr.subscriptionId,
                    resourceGroup: state.selectedAcr.resourceGroup,
                    acrName: state.selectedAcr.acrName,
                },
            });
        }
    };

    const handleRefreshPermissions = () => {
        refreshPermissions(state.selectedCluster, state.selectedAcr);
    };

    const handleStart = () => {
        if (state.selectedCluster && state.selectedAcr) {
            vscode.postStartKickstartRequest({
                clusterKey: {
                    subscriptionId: state.selectedCluster.subscriptionId,
                    resourceGroup: state.selectedCluster.resourceGroup,
                    clusterName: state.selectedCluster.clusterName,
                },
                acrKey: {
                    subscriptionId: state.selectedAcr.subscriptionId,
                    resourceGroup: state.selectedAcr.resourceGroup,
                    acrName: state.selectedAcr.acrName,
                },
            });
        }
    };

    const handleCancel = () => {
        window.acquireVsCodeApi?.();
    };

    const canStart = Boolean(
        state.selectedCluster &&
        state.selectedAcr &&
        state.permissions.hasAcrPull &&
        state.permissions.attached &&
        !state.permissions.loading,
    );

    return (
        <div data-testid="kickstart-root">
            <h2>{l10n.t("Kickstart AKS Cluster")}</h2>
            <p>{l10n.t("Configure your AKS cluster with an ACR and kickstart resources.")}</p>

            <Pickers
                subscriptions={state.subscriptions}
                selectedSub={state.selectedSub}
                onSubChange={handleSubChange}
                resourceGroups={state.resourceGroups}
                selectedRg={state.selectedRg}
                onRgChange={handleRgChange}
                clusters={state.clusters}
                selectedCluster={state.selectedCluster}
                onClusterChange={handleClusterChange}
                acrs={state.acrs}
                selectedAcr={state.selectedAcr}
                onAcrChange={handleAcrChange}
            />

            <PermissionChecks
                hasSelection={Boolean(state.selectedCluster && state.selectedAcr)}
                permissions={state.permissions}
                onAttach={handleAttach}
                onRefresh={handleRefreshPermissions}
            />

            <ActionBar canStart={canStart} onStart={handleStart} onCancel={handleCancel} />
        </div>
    );
}
