import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    Acr,
    AcrKey,
    Cluster,
    ClusterKey,
    InitialSelection,
    Subscription,
    SubscriptionKey,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { AttachAcrToCluster } from "../AttachAcrToCluster/AttachAcrToCluster";
import { stateUpdater } from "../AttachAcrToCluster/state/state";
import { Scenario } from "../utilities/manualTest";
import { delay } from "../utilities/time";

type ReferenceData = {
    subscriptions: SubscriptionData[];
};

type SubscriptionData = {
    subscription: Subscription;
    resourceGroups: ResourceGroupData[];
};

type ResourceGroupData = {
    group: string;
    acrs: AcrData[];
    clusterNames: string[];
};

type AcrData = {
    name: string;
    acrPull: {
        [clusterId: string]: boolean;
    };
};

function getReferenceData(): ReferenceData {
    return {
        subscriptions: Array.from({ length: 2 }, (_, i) => createSubscriptionData(i + 1)),
    };
}

function createSubscriptionData(subNumber: number): SubscriptionData {
    return {
        subscription: {
            subscriptionId: `5b516719-${String(subNumber).padStart(4, "0")}-0000-0000-000000000000`,
            name: `Test Sub ${subNumber}`,
        },
        resourceGroups: Array.from({ length: 2 }, (_, i) => createResourceGroupData(i + 1)),
    };
}

function createResourceGroupData(groupNumber: number): ResourceGroupData {
    return {
        group: `rg${groupNumber}`,
        clusterNames: Array.from({ length: 2 }, (_, i) => createClusterName(groupNumber, i + 1)),
        acrs: Array.from({ length: 2 }, (_, i) => createAcrData(groupNumber, i + 1)),
    };
}

function createClusterName(groupNumber: number, clusterNumber: number): string {
    return `rg${groupNumber}_cluster${clusterNumber}`;
}

function createAcrData(groupNumber: number, acrNumber: number): AcrData {
    return {
        name: `rg${groupNumber}acr${acrNumber}`,
        acrPull: {},
    };
}

function createUnpopulatedInitialSelection(): InitialSelection {
    return {};
}

function createPopulatedInitialSelection(referenceData: ReferenceData): InitialSelection {
    return {
        subscriptionId: referenceData.subscriptions[0].subscription.subscriptionId,
        acrResourceGroup: referenceData.subscriptions[0].resourceGroups[0].group,
        acrName: referenceData.subscriptions[0].resourceGroups[0].acrs[0].name,
        clusterResourceGroup: referenceData.subscriptions[0].resourceGroups[1].group,
        clusterName: referenceData.subscriptions[0].resourceGroups[1].clusterNames[0],
    };
}

export function getAttachAcrToClusterScenarios() {
    function getMessageHandler(
        webview: MessageSink<ToWebViewMsgDef>,
        referenceData: ReferenceData,
    ): MessageHandler<ToVsCodeMsgDef> {
        return {
            getSubscriptionsRequest: handleGetSubscriptionsRequest,
            getAcrsRequest: handleGetAcrsRequest,
            getClustersRequest: handleGetClustersRequest,
            getAcrRoleAssignmentRequest: (args) => handleGetAcrRoleAssignmentRequest(args.acrKey, args.clusterKey),
            createAcrRoleAssignmentRequest: (args) =>
                handleCreateAcrRoleAssignmentRequest(args.acrKey, args.clusterKey),
            deleteAcrRoleAssignmentRequest: (args) =>
                handleDeleteAcrRoleAssignmentRequest(args.acrKey, args.clusterKey),
        };

        async function handleGetSubscriptionsRequest() {
            await delay(2000);
            const subscriptions = referenceData.subscriptions.map((d) => d.subscription);
            webview.postGetSubscriptionsResponse({ subscriptions });
        }

        async function handleGetAcrsRequest(key: SubscriptionKey) {
            await delay(2000);
            const subData = referenceData.subscriptions.find(
                (d) => d.subscription.subscriptionId === key.subscriptionId,
            );
            const acrs: Acr[] =
                subData?.resourceGroups?.flatMap((g) =>
                    g.acrs.map((acr) => ({
                        ...key,
                        resourceGroup: g.group,
                        acrName: acr.name,
                    })),
                ) || [];

            webview.postGetAcrsResponse({ key, acrs });
        }

        async function handleGetClustersRequest(key: SubscriptionKey) {
            await delay(2000);
            const subData = referenceData.subscriptions.find(
                (d) => d.subscription.subscriptionId === key.subscriptionId,
            );
            const clusters: Cluster[] =
                subData?.resourceGroups?.flatMap((g) =>
                    g.clusterNames.map((clusterName) => ({
                        ...key,
                        resourceGroup: g.group,
                        clusterName,
                    })),
                ) || [];

            webview.postGetClustersResponse({ key, clusters });
        }

        async function handleGetAcrRoleAssignmentRequest(acrKey: AcrKey, clusterKey: ClusterKey) {
            await delay(2000);
            const subData = referenceData.subscriptions.find(
                (d) => d.subscription.subscriptionId === acrKey.subscriptionId,
            );
            const groupData = subData?.resourceGroups.find((g) => g.group === acrKey.resourceGroup);
            const acrData = groupData?.acrs.find((a) => a.name === acrKey.acrName);
            const hasAcrPull = acrData?.acrPull[`${clusterKey.resourceGroup}/${clusterKey.clusterName}`] || false;
            webview.postGetAcrRoleAssignmentResponse({ acrKey, clusterKey, hasAcrPull });
        }

        async function handleCreateAcrRoleAssignmentRequest(acrKey: AcrKey, clusterKey: ClusterKey) {
            await delay(2000);
            const subData = referenceData.subscriptions.find(
                (d) => d.subscription.subscriptionId === acrKey.subscriptionId,
            );
            const groupData = subData?.resourceGroups.find((g) => g.group === acrKey.resourceGroup);
            const acrData = groupData?.acrs.find((a) => a.name === acrKey.acrName);
            if (acrData === undefined) {
                return;
            }

            acrData.acrPull[`${clusterKey.resourceGroup}/${clusterKey.clusterName}`] = true;

            webview.postCreateAcrRoleAssignmentResponse({
                acrKey,
                clusterKey,
                hasAcrPull: true,
            });
        }

        async function handleDeleteAcrRoleAssignmentRequest(acrKey: AcrKey, clusterKey: ClusterKey) {
            await delay(2000);
            const subData = referenceData.subscriptions.find(
                (d) => d.subscription.subscriptionId === acrKey.subscriptionId,
            );
            const groupData = subData?.resourceGroups.find((g) => g.group === acrKey.resourceGroup);
            const acrData = groupData?.acrs.find((a) => a.name === acrKey.acrName);
            if (acrData === undefined) {
                return;
            }

            acrData.acrPull[`${clusterKey.resourceGroup}/${clusterKey.clusterName}`] = false;

            webview.postDeleteAcrRoleAssignmentResponse({
                acrKey,
                clusterKey,
                hasAcrPull: false,
            });
        }
    }

    function createScenario(name: string, getInitialSelection: (refData: ReferenceData) => InitialSelection) {
        const referenceData = getReferenceData();
        const initialSelection = getInitialSelection(referenceData);
        const initialState = { initialSelection };
        return Scenario.create(
            "attachAcrToCluster",
            name,
            () => <AttachAcrToCluster {...initialState} />,
            (webview) => getMessageHandler(webview, referenceData),
            stateUpdater.vscodeMessageHandler,
        );
    }

    return [
        createScenario("blank", createUnpopulatedInitialSelection),
        createScenario("populated", createPopulatedInitialSelection),
    ];
}
