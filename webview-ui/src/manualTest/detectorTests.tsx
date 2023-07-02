import { DetectorTypes } from "../../../src/webview-contract/webviewTypes";
import { Scenario } from "../utilities/manualTest";
import { Detector } from "../Detector/Detector";

// The following JSON data files were generated using `saveAllDetectorResponses` in the extension,
// and imports generated using:
// ls detectorData/*.json | xargs printf "import * as xxx from \"./%s\"\n" | sort -f
import * as aadIssues from "./detectorData/aad-issues.json"
import * as advisorAutoscalingClusters from "./detectorData/advisor-autoscaling-clusters.json"
import * as advisorBSeriesVms from "./detectorData/advisor-b-series-vms.json"
import * as advisorClusterLoadbalancer from "./detectorData/advisor-cluster-loadbalancer.json"
import * as advisorPodSecurityPolicy from "./detectorData/advisor-pod-security-policy.json"
import * as advisorSharedRouteTable from "./detectorData/advisor-shared-route-table.json"
import * as agentpoolImageUpgradeFailures from "./detectorData/agentpool-image-upgrade-failures.json"
import * as agentpoolPutFailures from "./detectorData/agentpool-put-failures.json"
import * as aksAzureCniAddressRanges from "./detectorData/aks-azure-cni-address-ranges.json"
import * as aksCasAndMultipleAzs from "./detectorData/aks-cas-and-multiple-azs.json"
import * as aksCategoryAvailabilityPerf from "./detectorData/aks-category-availability-perf.json"
import * as aksCategoryConnectivity from "./detectorData/aks-category-connectivity.json"
import * as aksCategoryCrud from "./detectorData/aks-category-crud.json"
import * as aksCategoryIdentitySecurity from "./detectorData/aks-category-identity-security.json"
import * as aksCategoryNodeHealth from "./detectorData/aks-category-node-health.json"
import * as aksCategoryRiskAssessment from "./detectorData/aks-category-risk-assessment.json"
import * as aksClusterDeleteFailures from "./detectorData/aks-cluster-delete-failures.json"
import * as aksClusterPutFailures from "./detectorData/aks-cluster-put-failures.json"
import * as aksDeprecatedNodeLabels from "./detectorData/aks-deprecated-node-labels.json"
import * as aksK8sDeprecations from "./detectorData/aks-k8s-deprecations.json"
import * as aksNodepoolDeleteFailures from "./detectorData/aks-nodepool-delete-failures.json"
import * as aksNpmBreakingchange from "./detectorData/aks-npm-breakingchange.json"
import * as aksPrivateIpsAndRanges from "./detectorData/aks-private-ips-and-ranges.json"
import * as aksRecommendUptimeSla from "./detectorData/aks-recommend-uptime-sla.json"
import * as aksReservedAddressRanges from "./detectorData/aks-reserved-address-ranges.json"
import * as aksRestrictedVmSkus from "./detectorData/aks-restricted-vm-skus.json"
import * as aksServiceImpactingIssues from "./detectorData/aks-service-impacting-issues.json"
import * as aksSubnetSharing from "./detectorData/aks-subnet-sharing.json"
import * as aksWindows2019Deprecation from "./detectorData/aks-windows2019-deprecation.json"
import * as aksWindowsDockerDeprecation from "./detectorData/aks-windowsdocker-deprecation.json"
import * as aksApiServerAuthorizedRanges2 from "./detectorData/aksapiserverauthorizedranges2.json"
import * as clusterAutoscalerFailures from "./detectorData/cluster-autoscaler-failures.json"
import * as clusterDns from "./detectorData/cluster-dns.json"
import * as clusterMinVersion from "./detectorData/cluster-min-version.json"
import * as clusterStartStopFailures from "./detectorData/cluster-stop-start-failures.json"
import * as clusterSubnet from "./detectorData/cluster-subnet.json"
import * as clusterCertExpiredDetailed from "./detectorData/clusterCertExpiredDetailed.json"
import * as containerdMasqueradingIps from "./detectorData/containerd-masquerading-ips.json"
import * as customerThrottling from "./detectorData/customerthrottling.json"
import * as etcd from "./detectorData/Etcd.json"
import * as incorrectOsDiskConfiguration from "./detectorData/incorrect-os-disk-configuration.json"
import * as incorrectPodDisruptionBudgets from "./detectorData/incorrect-pod-disruption-budgets.json"
import * as invalidClientServicePrincipal from "./detectorData/InvalidClientServicePrincipal.json"
import * as kmsIssues from "./detectorData/kms-issues.json"
import * as nodePidPressureAlerts from "./detectorData/node-pid-pressure-alerts.json"
import * as nodeDiskPressure from "./detectorData/NodeDiskPressure.json"
import * as nodeMemoryPressure from "./detectorData/NodeMemoryPressure.json"
import * as nodePerfCpu from "./detectorData/nodeperfcpu.json"
import * as nodesNotReadyAlerts from "./detectorData/nodes-not-ready-alerts.json"
import * as oomkilled from "./detectorData/oomkilled.json"
import * as podSubnetFull from "./detectorData/pod-subnet-full.json"
import * as privateClusterDns from "./detectorData/private-cluster-dns.json"
import * as provisioningStatusNodePool from "./detectorData/ProvisioningStatusNodePool.json"
import * as resetAuthProfile from "./detectorData/reset-auth-profile.json"
import * as rotateClusterCertificate from "./detectorData/rotate-cluster-certificate.json"
import * as snatUsage from "./detectorData/snat-usage.json"
import * as userDefinedRouting from "./detectorData/user-defined-routing.json"
import * as windowsRegressionK8sv124 from "./detectorData/windowsregresionk8sv124.json"

type DetectorDataMap = {
    [detectorId: string]: DetectorTypes.SingleDetectorARMResponse
};

const categoryDetectors: DetectorTypes.CategoryDetectorARMResponse[] = [
    aksCategoryAvailabilityPerf,
    aksCategoryConnectivity,
    aksCategoryCrud,
    aksCategoryIdentitySecurity,
    aksCategoryNodeHealth,
    aksCategoryRiskAssessment
];

const singleDetectors: DetectorTypes.SingleDetectorARMResponse[] = [
    aadIssues,
    advisorAutoscalingClusters,
    advisorBSeriesVms,
    advisorClusterLoadbalancer,
    advisorPodSecurityPolicy,
    advisorSharedRouteTable,
    agentpoolImageUpgradeFailures,
    agentpoolPutFailures,
    aksApiServerAuthorizedRanges2,
    aksAzureCniAddressRanges,
    aksCasAndMultipleAzs,
    aksClusterDeleteFailures,
    aksClusterPutFailures,
    aksDeprecatedNodeLabels,
    aksK8sDeprecations,
    aksNodepoolDeleteFailures,
    aksNpmBreakingchange,
    aksPrivateIpsAndRanges,
    aksRecommendUptimeSla,
    aksReservedAddressRanges,
    aksRestrictedVmSkus,
    aksServiceImpactingIssues,
    aksSubnetSharing,
    aksWindows2019Deprecation,
    aksWindowsDockerDeprecation,
    clusterAutoscalerFailures,
    clusterDns,
    clusterCertExpiredDetailed,
    clusterMinVersion,
    clusterStartStopFailures,
    clusterSubnet,
    containerdMasqueradingIps,
    customerThrottling,
    etcd,
    incorrectOsDiskConfiguration,
    incorrectPodDisruptionBudgets,
    invalidClientServicePrincipal,
    kmsIssues,
    nodeDiskPressure,
    nodeMemoryPressure,
    nodePerfCpu,
    nodePidPressureAlerts,
    nodesNotReadyAlerts,
    oomkilled,
    podSubnetFull,
    privateClusterDns,
    provisioningStatusNodePool,
    resetAuthProfile,
    rotateClusterCertificate,
    snatUsage,
    userDefinedRouting,
    windowsRegressionK8sv124
];

const singleDetectorLookup: DetectorDataMap = singleDetectors.reduce((result: DetectorDataMap, response) => {
    let newResult = {...result};
    newResult[response.name] = response;
    return newResult;
}, {});

export function getDetectorScenarios() {
    return categoryDetectors.map(categoryDetector => {
        const detectorIds = categoryDetector.properties.dataset.filter(DetectorTypes.isCategoryDataset)[0].renderingProperties.detectorIds;
        const initialState: DetectorTypes.InitialState = {
            name: categoryDetector.properties.metadata.name,
            description: categoryDetector.properties.metadata.description,
            clusterArmId: getClusterArmId(categoryDetector),
            portalReferrerContext: "vscode-aks-tools-test",
            detectors: detectorIds.map(id => singleDetectorLookup[id])
        };

        return Scenario.create(`${DetectorTypes.contentId} (${initialState.name})`, () => <Detector {...initialState} />);
    });
}

function getClusterArmId(response: DetectorTypes.ARMResponse<any>): string {
    return response.id.split('detectors')[0];
}