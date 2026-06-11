import { OutputChannel } from "vscode";
import * as l10n from "@vscode/l10n";
import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { AzureAuthenticationSession, ReadyAzureSessionProvider } from "../auth/types";
import { getEnvironment } from "../auth/azureAuth";
import {
    getAksClient,
    getAuthorizationManagementClient,
    getFeatureClient,
    getResourceManagementClient,
} from "../commands/utils/arm";
import { getPortalResourceUrl } from "../commands/utils/env";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { createAcr, getAcrRegistry } from "../commands/utils/acrs";
import { DefinedManagedCluster, getManagedCluster } from "../commands/utils/clusters";
import {
    MultipleFeatureRegistration,
    createMultipleFeatureRegistrations,
} from "../commands/utils/featureRegistrations";
import { createRoleAssignment, getScopeForAcr, getScopeForCluster } from "../commands/utils/roleAssignments";
import { acrPullRoleDefinitionName } from "../webview-contract/webviewDefinitions/attachAcrToCluster";
import { PresetType } from "../webview-contract/webviewDefinitions/createCluster";
import { ClusterSelections, ExistingClusterSelection } from "../webview-contract/webviewDefinitions/kickstartCluster";
import { ClusterDeploymentBuilder, ClusterSpec } from "./utilities/ClusterSpecCreationBuilder";
import { ActivityReporter, ActivitySink, CancellationToken } from "./kickstartActivity";

const DEPLOYMENT_API_VERSION = "2021-04-01";

const AUTOMATIC_PREVIEW_FEATURES: MultipleFeatureRegistration[] = [
    { resourceProviderNamespace: "Microsoft.ContainerService", featureName: "EnableAPIServerVnetIntegrationPreview" },
    { resourceProviderNamespace: "Microsoft.ContainerService", featureName: "NRGLockdownPreview" },
    { resourceProviderNamespace: "Microsoft.ContainerService", featureName: "SafeguardsPreview" },
    { resourceProviderNamespace: "Microsoft.ContainerService", featureName: "DisableSSHPreview" },
    { resourceProviderNamespace: "Microsoft.ContainerService", featureName: "AutomaticSKUPreview" },
];

interface DeploymentIdentity {
    username: string;
    servicePrincipalId: string;
}

export interface ClusterProvisioningResult {
    succeeded: boolean;
    clusterName: string;
    clusterPortalUrl: string | null;
    acrName: string;
    acrLoginServer: string | null;
}

export async function runClusterProvisioning(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    token: CancellationToken,
): Promise<ClusterProvisioningResult> {
    const reporter = new ActivityReporter("provision", runId, sink, channel, token);
    const result: ClusterProvisioningResult = {
        succeeded: false,
        clusterName: selections.clusterName,
        clusterPortalUrl: null,
        acrName: selections.acrName,
        acrLoginServer: null,
    };

    const groupStage = reporter.stage("resourceGroup", l10n.t("Resource group"));
    try {
        if (selections.isNewResourceGroup) {
            await groupStage.run(l10n.t("Creating {0}", selections.resourceGroupName), () =>
                createResourceGroup(sessionProvider, selections),
            );
            groupStage.succeed(l10n.t("Created resource group {0}.", selections.resourceGroupName));
        } else {
            groupStage.succeed(l10n.t("Using existing resource group {0}.", selections.resourceGroupName));
        }
    } catch (e) {
        groupStage.fail(getErrorMessage(e));
        return result;
    }

    const clusterStage = reporter.stage("cluster", l10n.t("AKS Automatic cluster"));
    try {
        const kubernetesVersion = await clusterStage.run(
            l10n.t("Selecting Kubernetes version"),
            () => resolveDefaultKubernetesVersion(sessionProvider, selections.subscriptionId, selections.location),
            (version) => version,
        );
        const identity = await clusterStage.run(l10n.t("Resolving your account identity"), () =>
            resolveDeploymentIdentity(sessionProvider),
        );
        await clusterStage.run(l10n.t("Registering preview features"), () =>
            createMultipleFeatureRegistrations(
                getFeatureClient(sessionProvider, selections.subscriptionId),
                AUTOMATIC_PREVIEW_FEATURES,
            ),
        );
        result.clusterPortalUrl = await clusterStage.run(
            l10n.t("Deploying cluster — this can take several minutes"),
            () => deployAutomaticCluster(sessionProvider, selections, kubernetesVersion, identity),
        );
        clusterStage.succeed(l10n.t("Cluster {0} is ready.", selections.clusterName));
    } catch (e) {
        clusterStage.fail(getErrorMessage(e));
        return result;
    }

    const acrStage = reporter.stage("acr", l10n.t("Azure Container Registry"));
    try {
        const registry = await acrStage.run(
            l10n.t("Creating registry {0}", selections.acrName),
            async () => {
                const created = await createAcr(
                    sessionProvider,
                    selections.subscriptionId,
                    selections.resourceGroupName,
                    selections.acrName,
                    selections.location,
                );
                if (failed(created)) {
                    throw new Error(created.error);
                }
                return created.result;
            },
            (registry) => registry.loginServer,
        );
        result.acrLoginServer = registry.loginServer;
        acrStage.succeed(l10n.t("Registry {0} is ready.", registry.loginServer));
    } catch (e) {
        acrStage.fail(getErrorMessage(e));
        return result;
    }

    const attachStage = reporter.stage("attach", l10n.t("Connect registry to cluster"));
    try {
        await attachStage.run(l10n.t("Granting the cluster permission to pull images"), () =>
            attachAcrToCluster(sessionProvider, selections),
        );
        attachStage.succeed(l10n.t("{0} can now pull images from {1}.", selections.clusterName, selections.acrName));
    } catch (e) {
        attachStage.fail(getErrorMessage(e));
        return result;
    }

    result.succeeded = true;
    return result;
}

export async function attachRegistryToExistingCluster(
    sessionProvider: ReadyAzureSessionProvider,
    selection: ExistingClusterSelection,
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    token: CancellationToken,
): Promise<ClusterProvisioningResult> {
    const reporter = new ActivityReporter("provision", runId, sink, channel, token);
    const result: ClusterProvisioningResult = {
        succeeded: false,
        clusterName: selection.clusterName,
        clusterPortalUrl: null,
        acrName: selection.acrName,
        acrLoginServer: null,
    };

    let clusterLocation = "";
    let kubeletPrincipalId: string | null = null;
    const clusterStage = reporter.stage("cluster", l10n.t("AKS cluster"));
    try {
        const cluster = await clusterStage.run(l10n.t("Resolving cluster {0}", selection.clusterName), async () => {
            const found = await getManagedCluster(
                sessionProvider,
                selection.subscriptionId,
                selection.clusterResourceGroup,
                selection.clusterName,
            );
            if (failed(found)) {
                throw new Error(found.error);
            }
            return found.result;
        });
        clusterLocation = cluster.location;
        kubeletPrincipalId = getKubeletPrincipalId(cluster);
        const clusterArmId = getScopeForCluster(
            selection.subscriptionId,
            selection.clusterResourceGroup,
            selection.clusterName,
        );
        result.clusterPortalUrl = getPortalResourceUrl(getEnvironment(), clusterArmId);
        clusterStage.succeed(l10n.t("Using cluster {0}.", selection.clusterName));
    } catch (e) {
        clusterStage.fail(getErrorMessage(e));
        return result;
    }

    const acrStage = reporter.stage("acr", l10n.t("Azure Container Registry"));
    try {
        const registry = await acrStage.run(
            selection.createNewAcr
                ? l10n.t("Creating registry {0}", selection.acrName)
                : l10n.t("Confirming registry {0}", selection.acrName),
            async () => {
                const registryResult = selection.createNewAcr
                    ? await createAcr(
                          sessionProvider,
                          selection.subscriptionId,
                          selection.acrResourceGroup,
                          selection.acrName,
                          clusterLocation,
                      )
                    : await getAcrRegistry(
                          sessionProvider,
                          selection.subscriptionId,
                          selection.acrResourceGroup,
                          selection.acrName,
                      );
                if (failed(registryResult)) {
                    throw new Error(registryResult.error);
                }
                return registryResult.result;
            },
            (registry) => registry.loginServer,
        );
        result.acrLoginServer = registry.loginServer;
        acrStage.succeed(l10n.t("Registry {0} is ready.", registry.loginServer));
    } catch (e) {
        acrStage.fail(getErrorMessage(e));
        return result;
    }

    const attachStage = reporter.stage("attach", l10n.t("Connect registry to cluster"));
    try {
        if (selection.createNewAcr) {
            await attachStage.run(l10n.t("Granting the cluster permission to pull images"), async () => {
                if (!kubeletPrincipalId) {
                    throw new Error(l10n.t("Couldn't find the cluster identity needed to grant registry access."));
                }
                const client = getAuthorizationManagementClient(sessionProvider, selection.subscriptionId);
                await grantAcrPull(
                    client,
                    selection.subscriptionId,
                    kubeletPrincipalId,
                    selection.acrResourceGroup,
                    selection.acrName,
                );
            });
            attachStage.succeed(l10n.t("{0} can now pull images from {1}.", selection.clusterName, selection.acrName));
        } else {
            attachStage.succeed(
                l10n.t(
                    "{0} is already connected to {1}, so no permission changes are needed.",
                    selection.clusterName,
                    selection.acrName,
                ),
            );
        }
    } catch (e) {
        attachStage.fail(getErrorMessage(e));
        return result;
    }

    result.succeeded = true;
    return result;
}

async function createResourceGroup(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
): Promise<void> {
    const client = getResourceManagementClient(sessionProvider, selections.subscriptionId);
    await client.resourceGroups.createOrUpdate(selections.resourceGroupName, { location: selections.location });
}

async function resolveDefaultKubernetesVersion(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    location: string,
): Promise<string> {
    const client = getAksClient(sessionProvider, subscriptionId);
    const versionsResult = await client.managedClusters.listKubernetesVersions(location);
    const versions = versionsResult.values || [];
    const preferred = versions.find((v) => "isDefault" in v && v.isDefault === true) ?? versions[0];
    if (!preferred?.version) {
        throw new Error(l10n.t("No Kubernetes versions are available in {0}.", location));
    }
    return preferred.version;
}

async function resolveDeploymentIdentity(sessionProvider: ReadyAzureSessionProvider): Promise<DeploymentIdentity> {
    const session = await sessionProvider.getAuthSession();
    if (failed(session)) {
        throw new Error(session.error);
    }
    const servicePrincipalId = getServicePrincipalId(session.result);
    if (!servicePrincipalId) {
        throw new Error(l10n.t("Couldn't determine the signed-in user's identity for cluster RBAC."));
    }
    return { username: session.result.account.label, servicePrincipalId };
}

async function deployAutomaticCluster(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
    kubernetesVersion: string,
    identity: DeploymentIdentity,
): Promise<string> {
    const clusterSpec: ClusterSpec = {
        location: selections.location,
        name: selections.clusterName,
        resourceGroupName: selections.resourceGroupName,
        subscriptionId: selections.subscriptionId,
        kubernetesVersion,
        username: identity.username,
        servicePrincipalId: identity.servicePrincipalId,
    };

    const deployment = new ClusterDeploymentBuilder()
        .buildCommonParameters(clusterSpec, PresetType.Automatic)
        .buildTemplate(PresetType.Automatic)
        .getDeployment();

    const deploymentName = `${selections.clusterName}-${Math.random().toString(36).substring(5)}`;
    const deploymentResourceId = `/subscriptions/${selections.subscriptionId}/resourceGroups/${selections.resourceGroupName}/providers/Microsoft.Resources/deployments/${deploymentName}`;

    const client = getResourceManagementClient(sessionProvider, selections.subscriptionId);
    const poller = await client.resources.beginCreateOrUpdateById(deploymentResourceId, DEPLOYMENT_API_VERSION, {
        properties: deployment.properties,
    });
    await poller.pollUntilDone();

    const clusterArmId = `/subscriptions/${selections.subscriptionId}/resourceGroups/${selections.resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${selections.clusterName}`;
    return getPortalResourceUrl(getEnvironment(), clusterArmId);
}

async function attachAcrToCluster(
    sessionProvider: ReadyAzureSessionProvider,
    selections: ClusterSelections,
): Promise<void> {
    const principalId = await resolveClusterKubeletPrincipalId(
        sessionProvider,
        selections.subscriptionId,
        selections.resourceGroupName,
        selections.clusterName,
    );
    const client = getAuthorizationManagementClient(sessionProvider, selections.subscriptionId);
    await grantAcrPull(
        client,
        selections.subscriptionId,
        principalId,
        selections.resourceGroupName,
        selections.acrName,
    );
}

async function grantAcrPull(
    client: AuthorizationManagementClient,
    subscriptionId: string,
    principalId: string,
    acrResourceGroup: string,
    acrName: string,
): Promise<void> {
    const scope = getScopeForAcr(subscriptionId, acrResourceGroup, acrName);
    const assignment = await createRoleAssignment(
        client,
        subscriptionId,
        principalId,
        acrPullRoleDefinitionName,
        scope,
        "ServicePrincipal",
    );
    if (failed(assignment)) {
        throw new Error(assignment.error);
    }
}

export async function resolveClusterKubeletPrincipalId(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): Promise<string> {
    const cluster = await getManagedCluster(sessionProvider, subscriptionId, resourceGroup, clusterName);
    if (failed(cluster)) {
        throw new Error(cluster.error);
    }

    const principalId = getKubeletPrincipalId(cluster.result);
    if (!principalId) {
        throw new Error(l10n.t("Couldn't find the cluster identity needed to grant registry access."));
    }
    return principalId;
}

function getKubeletPrincipalId(cluster: DefinedManagedCluster): string | null {
    const kubeletIdentity =
        cluster.identityProfile && "kubeletidentity" in cluster.identityProfile
            ? cluster.identityProfile.kubeletidentity
            : undefined;
    return kubeletIdentity?.objectId ?? null;
}

function getServicePrincipalId(session: AzureAuthenticationSession): string {
    if (!session?.account?.id) {
        return "";
    }
    const accountId = session.account.id;
    if (accountId.includes("/")) {
        return accountId.split("/")[1];
    }
    if (accountId.includes(".")) {
        return accountId.split(".")[0];
    }
    return "";
}
