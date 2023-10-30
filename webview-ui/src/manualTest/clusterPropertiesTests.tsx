import { Scenario } from "../utilities/manualTest";
import { AgentPoolProfileInfo, ClusterInfo, InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { stateUpdater } from "../ClusterProperties/state";
import { ClusterProperties } from "../ClusterProperties/ClusterProperties";

function sometimes() {
    return ~~(Math.random() * 3) === 0;
}

let testSystemPool: AgentPoolProfileInfo = {
    name: "systempool",
    nodeImageVersion: "AKSUbuntu-1804gen2containerd-202309.06.0",
    powerStateCode: "Running",
    osDiskSizeGB: 128,
    provisioningState: "Succeeded",
    vmSize: "Standard_DS2_v2",
    count: 3,
    osType: "Linux"
};

let testWindows2019Pool: AgentPoolProfileInfo = {
    name: "win2019",
    nodeImageVersion: "AKSWindows-2019-containerd-17763.4851.230914",
    powerStateCode: "Running",
    osDiskSizeGB: 128,
    provisioningState: "Succeeded",
    vmSize: "Standard_D2s_v3",
    count: 4,
    osType: "Windows"
};

let testWindows2022Pool: AgentPoolProfileInfo = {
    name: "win2022",
    nodeImageVersion: "AKSWindows-2022-containerd-20348.1970.230914",
    powerStateCode: "Running",
    osDiskSizeGB: 128,
    provisioningState: "Succeeded",
    vmSize: "Standard_D2s_v3",
    count: 8,
    osType: "Windows"
};

let testClusterInfo: ClusterInfo = {
    provisioningState: "Succeeded",
    fqdn: "testcluster-w-testrg-4340d4fda1c9.hcp.eastus.azmk8s.io",
    kubernetesVersion: "1.24.6",
    powerStateCode: "Running",
    agentPoolProfiles: [testSystemPool, testWindows2019Pool, testWindows2022Pool]
};

export function getClusterPropertiesScenarios() {
    const initialState: InitialState = {
        clusterName: "test-cluster"
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>, withErrors: boolean): MessageHandler<ToVsCodeMsgDef> {
        return {
            getPropertiesRequest: () => handleGetPropertiesRequest(),
            stopClusterRequest: () => handleStopClusterRequest(withErrors && sometimes()),
            startClusterRequest: () => handleStartClusterRequest(withErrors && sometimes()),
        };

        async function handleGetPropertiesRequest() {
            await new Promise(resolve => setTimeout(resolve, 3000));
            webview.postGetPropertiesResponse(testClusterInfo);
        }

        async function handleStopClusterRequest(hasError: boolean) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (hasError) {
                webview.postErrorNotification("Sorry, I wasn't quite able to stop the cluster.");
                return;
            }

            testClusterInfo.provisioningState = "Stopping";
            testClusterInfo.powerStateCode = "Stopped";
            testClusterInfo.agentPoolProfiles.forEach(p => {
                p.provisioningState = "Stopping";
                p.powerStateCode = "Stopped"
            });
            webview.postGetPropertiesResponse(testClusterInfo);

            await new Promise(resolve => setTimeout(resolve, 10000));
            testClusterInfo.provisioningState = "Succeeded";
            testClusterInfo.powerStateCode = "Stopped";
            testClusterInfo.agentPoolProfiles.forEach(p => {
                p.provisioningState = "Succeeded";
                p.powerStateCode = "Stopped"
            });
            webview.postGetPropertiesResponse(testClusterInfo);
        }

        async function handleStartClusterRequest(hasError: boolean) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (hasError) {
                webview.postErrorNotification("Sorry, I wasn't quite able to get the cluster started.");
                return;
            }

            testClusterInfo.provisioningState = "Starting";
            testClusterInfo.powerStateCode = "Running";
            testClusterInfo.agentPoolProfiles.forEach(p => {
                p.provisioningState = "Starting";
                p.powerStateCode = "Running"
            });
            webview.postGetPropertiesResponse(testClusterInfo);

            await new Promise(resolve => setTimeout(resolve, 10000));
            testClusterInfo.provisioningState = "Succeeded";
            testClusterInfo.powerStateCode = "Running";
            testClusterInfo.agentPoolProfiles.forEach(p => {
                p.provisioningState = "Succeeded";
                p.powerStateCode = "Running"
            });
            webview.postGetPropertiesResponse(testClusterInfo);
        }
    }

    return [
        Scenario.create("clusterProperties", "succeeding", () => <ClusterProperties {...initialState} />, (webview) => getMessageHandler(webview, false), stateUpdater.vscodeMessageHandler),
        Scenario.create("clusterProperties", "with errors", () => <ClusterProperties {...initialState} />, (webview) => getMessageHandler(webview, true), stateUpdater.vscodeMessageHandler)
    ];
}